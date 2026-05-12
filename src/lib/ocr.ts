import corePath from 'tesseract.js-core/tesseract-core.wasm.js?url';
import Anthropic from '@anthropic-ai/sdk';

const workerPath = '/tesseract.worker.js';
const CLAUDE_API_KEY = import.meta.env.VITE_CLAUDE_API_KEY;

export interface ParsedReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  confidence: number;
}

export interface ParsedReceipt {
  storeName: string;
  storeAddress: string;
  location: string;
  zipCode?: string;
  phone?: string;
  date: string;
  dateTime?: string;
  coordinates?: string;
  items: ParsedReceiptItem[];
  subtotal: number;
  tax: number;
  total: number;
  rawText: string;
}

/**
 * Run Tesseract OCR on an image file/blob and return raw text.
 */
export async function extractTextFromImage(
  image: File | Blob | string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    corePath,
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
    workerBlobURL: false,
    workerPath,
  });

  const { data } = await worker.recognize(image);
  await worker.terminate();
  return data.text;
}

/**
 * Parse Claude's natural language response into structured receipt data
 */
function parseClaudeResponse(responseText: string): any {
  const fallback = {
    storeName: '',
    storeAddress: '',
    location: '',
    zipCode: '',
    phone: '',
    dateTime: '',
    coordinates: '',
    items: [] as any[],
    subtotal: 0,
    tax: 0,
    total: 0,
  };

  let parsed: any = null;
  const trimmed = responseText.trim();

  // Try strict JSON parse first
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // If there is extra text before/after JSON, try to extract JSON substring
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (parsed && typeof parsed === 'object') {
    return {
      storeName: parsed.storeName || fallback.storeName,
      storeAddress: parsed.storeAddress || fallback.storeAddress,
      location: parsed.location || fallback.location,
      zipCode: parsed.zipCode || fallback.zipCode,
      phone: parsed.phone || fallback.phone,
      dateTime: parsed.dateTime || fallback.dateTime,
      coordinates: parsed.coordinates || fallback.coordinates,
      items: Array.isArray(parsed.items)
        ? parsed.items.map((item: any) => ({
            name: item.name || 'Unknown Item',
            quantity: item.quantity ? Number(item.quantity) : 1,
            unitPrice: item.unitPrice ? Number(item.unitPrice) : 0,
            totalPrice: item.totalPrice ? Number(item.totalPrice) : 0,
          }))
        : fallback.items,
      subtotal: parsed.subtotal ? Number(parsed.subtotal) : fallback.subtotal,
      tax: parsed.tax ? Number(parsed.tax) : fallback.tax,
      total: parsed.total ? Number(parsed.total) : fallback.total,
    };
  }

  // Fallback: simple line-based extraction
  const lines = responseText.split('\n').map(line => line.trim()).filter(line => line);
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (!fallback.storeName && lowerLine.includes('store name')) {
      const match = line.match(/store name[:\s]*([^,]+)/i);
      if (match) fallback.storeName = match[1].trim();
    }
    if (!fallback.storeAddress && lowerLine.includes('address')) {
      const match = line.match(/address[:\s]*(.+)/i);
      if (match) fallback.storeAddress = match[1].trim();
    }
    if (!fallback.zipCode) {
      const match = line.match(/\b(\d{5})(?:-\d{4})?\b/);
      if (match) fallback.zipCode = match[1];
    }
    if (!fallback.phone) {
      const match = line.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
      if (match) fallback.phone = match[0];
    }
    if (!fallback.dateTime && lowerLine.includes('date')) {
      fallback.dateTime = line.replace(/date[:\s]*/i, '').trim();
    }
    if (!fallback.coordinates && lowerLine.includes('coord')) {
      fallback.coordinates = line.replace(/coordinates?[:\s]*/i, '').trim();
    }
  }

  const itemPatterns = [
    /(.+?)\s*-\s*\$?(\d+\.\d{2})/g,
    /(.+?)\s+\$?(\d+\.\d{2})/g,
  ];

  for (const line of lines) {
    for (const pattern of itemPatterns) {
      const matches = [...line.matchAll(pattern)];
      for (const match of matches) {
        const itemName = match[1].trim();
        const price = parseFloat(match[2]);
        const lowerName = itemName.toLowerCase();
        if (['subtotal', 'total', 'tax', 'change', 'amount', 'balance'].some((token) => lowerName.includes(token))) {
          continue;
        }
        fallback.items.push({
          name: itemName,
          quantity: 1,
          unitPrice: price,
          totalPrice: price,
        });
      }
    }
  }

  if (fallback.items.length > 0) {
    fallback.subtotal = fallback.items.reduce((sum, item) => sum + item.totalPrice, 0);
    fallback.total = fallback.subtotal;
  }

  return fallback;
}

/**
 * Extract receipt data using Claude AI vision API
 */
export async function extractReceiptWithClaude(
  image: File | Blob | string,
  onProgress?: (progress: number) => void
): Promise<ParsedReceipt> {
  if (!CLAUDE_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  try {
    onProgress?.(10);

    // Convert image to base64
    const base64Image = await convertImageToBase64(image);
    onProgress?.(30);

    const anthropic = new Anthropic({
      apiKey: CLAUDE_API_KEY,
      dangerouslyAllowBrowser: true, // Required for client-side usage
    });

    onProgress?.(50);

    // Detect actual image format so Claude receives the correct media type
    const mediaType = ((): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' => {
      if (image instanceof File) {
        if (image.type === 'image/png') return 'image/png';
        if (image.type === 'image/webp') return 'image/webp';
        if (image.type === 'image/gif') return 'image/gif';
      }
      return 'image/jpeg';
    })();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `You are a market analyst. Review the attached receipt image and extract the information below in strict JSON format only. Do not add any extra explanation.

{
  "storeName": "Store name",
  "storeAddress": "Full address",
  "zipCode": "ZIP code",
  "phone": "Phone number",
  "dateTime": "Date and time",
  "location": "City, state",
  "coordinates": "Latitude, longitude",
  "items": [
    {
      "name": "Item name",
      "quantity": 1,
      "unitPrice": 0.00,
      "totalPrice": 0.00
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00
}

- List grocery items with price per unit.
- If quantity is not shown, use 1.
- Extract store name, address, ZIP, phone, date & time, and coordinates.
- Return valid JSON only, nothing else.`,
            },
          ],
        },
      ],
    });

    onProgress?.(80);

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse the natural language response from Claude
    const parsedData = parseClaudeResponse(responseText);

    // If Claude returned no items, fall back to OCR parsing from the image text.
    if (!parsedData.items?.length) {
      console.warn('Claude returned no items; falling back to OCR item parsing.');
      const rawText = await extractTextFromImage(image);
      const ocrParsed = parseReceiptText(rawText);
      return {
        ...ocrParsed,
        storeName: parsedData.storeName || ocrParsed.storeName,
        storeAddress: parsedData.storeAddress || ocrParsed.storeAddress,
        location: parsedData.location || ocrParsed.location,
        zipCode: parsedData.zipCode || ocrParsed.zipCode,
        phone: parsedData.phone || ocrParsed.phone || '',
        date: parsedData.dateTime || ocrParsed.date,
        dateTime: parsedData.dateTime || ocrParsed.date,
        coordinates: parsedData.coordinates || ocrParsed.coordinates || '',
        rawText: responseText || rawText,
      };
    }

    // Validate and clean the response
    const receipt: ParsedReceipt = {
      storeName: parsedData.storeName || 'Unknown Store',
      storeAddress: parsedData.storeAddress || '',
      location: parsedData.location || '',
      zipCode: parsedData.zipCode,
      phone: parsedData.phone || '',
      date: parsedData.dateTime ? parsedData.dateTime : new Date().toISOString().split('T')[0],
      dateTime: parsedData.dateTime || '',
      coordinates: parsedData.coordinates || '',
      items: (parsedData.items || []).map((item: any, index: number) => ({
        id: `item-${index + 1}`,
        name: item.name || 'Unknown Item',
        quantity: Math.max(1, parseInt(item.quantity) || 1),
        unitPrice: parseFloat(item.unitPrice) || 0,
        totalPrice: parseFloat(item.totalPrice) || 0,
        confidence: 0.95, // Higher confidence for Claude extraction
      })),
      subtotal: parsedData.subtotal || 0,
      tax: 0, // Not extracted in new prompt
      total: parsedData.total || 0,
      rawText: responseText,
    };

    // Calculate missing totals if needed
    if (receipt.subtotal === 0) {
      receipt.subtotal = receipt.items.reduce((sum, item) => sum + item.totalPrice, 0);
    }
    if (receipt.total === 0) {
      receipt.total = receipt.subtotal + receipt.tax;
    }

    onProgress?.(100);
    return receipt;

  } catch (error) {
    console.error('Claude API extraction failed:', error);
    throw new Error(`Claude extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert image to base64 string for Claude API
 */
async function convertImageToBase64(image: File | Blob | string): Promise<string> {
  let blob: Blob;

  if (typeof image === 'string') {
    // Assume it's a data URL or file path
    const response = await fetch(image);
    blob = await response.blob();
  } else if (image instanceof File) {
    blob = image;
  } else {
    blob = image;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix if present
      const base64 = result.replace(/^data:image\/[a-z]+;base64,/, '');
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Extract receipt data using Claude AI, with OCR fallback
 */
export async function extractReceiptData(
  image: File | Blob | string,
  onProgress?: (progress: number) => void
): Promise<ParsedReceipt> {
  // Try Claude first if API key is available and valid
  if (CLAUDE_API_KEY && CLAUDE_API_KEY !== 'your_claude_api_key_here' && !CLAUDE_API_KEY.includes('your_')) {
    try {
      return await extractReceiptWithClaude(image, onProgress);
    } catch (error) {
      console.warn('Claude extraction failed, falling back to OCR:', error);
      // Continue to OCR fallback
    }
  }

  // Fallback to OCR
  onProgress?.(10);
  const rawText = await extractTextFromImage(image, (progress) => {
    // Adjust progress for OCR phase (40-90%)
    onProgress?.(40 + progress * 0.5);
  });
  onProgress?.(90);

  const parsed = parseReceiptText(rawText);
  onProgress?.(100);

  return parsed;
}

/**
 * Parse raw OCR text into structured receipt data.
 * Handles common US thermal receipt formats.
 */
export function parseReceiptText(rawText: string): ParsedReceipt {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Try to detect store name (usually first non-empty line or known chains)
  const knownStores = ['walmart', 'target', 'costco', 'kroger', "sam's club", 'aldi', 'publix', 'whole foods', 'trader joe'];
  let storeName = 'Unknown Store';
  for (const line of lines.slice(0, 5)) {
    const lower = line.toLowerCase();
    const match = knownStores.find((s) => lower.includes(s));
    if (match) {
      storeName = match.charAt(0).toUpperCase() + match.slice(1);
      break;
    }
  }
  if (storeName === 'Unknown Store' && lines.length > 0) {
    storeName = lines[0].substring(0, 30);
  }

  const zipCode = extractZipCode(lines.join(' '));
  const storeAddress = extractAddress(lines);
  const location = extractLocation(lines, storeAddress);

  // Try to find a date (MM/DD/YYYY or MM-DD-YYYY patterns)
  let date = new Date().toISOString().split('T')[0];
  const dateRegex = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
  for (const line of lines) {
    const m = line.match(dateRegex);
    if (m) {
      const year = m[3].length === 2 ? '20' + m[3] : m[3];
      date = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      break;
    }
  }

  // Parse item lines: look for lines with a price pattern at the end
  const pricePattern = /\$?\s*(\d{1,4}\.\d{2})\s*[A-Z]?\s*$/;
  const items: ParsedReceiptItem[] = [];
  let idCounter = 0;

  for (const line of lines) {
    const priceMatch = line.match(pricePattern);
    if (!priceMatch) continue;

    const price = parseFloat(priceMatch[1]);
    if (price <= 0 || price > 999) continue;

    // Extract item name (everything before the price)
    let name = line.substring(0, priceMatch.index || 0).trim();
    // Remove leading quantities like "2 x" or "2@"
    let quantity = 1;
    const qtyMatch = name.match(/^(\d+)\s*[x@]\s*/i);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10) || 1;
      name = name.substring(qtyMatch[0].length).trim();
    }

    const inlineQtyPriceMatch = name.match(/^(.*?)(\d+)\s*@\s*(\d{1,4}\.\d{2})\s*$/i);
    if (inlineQtyPriceMatch) {
      name = inlineQtyPriceMatch[1].trim();
      const inlineQty = Number.parseInt(inlineQtyPriceMatch[2], 10);
      if (inlineQty > 0) {
        quantity = inlineQty;
      }
    }

    // Skip lines that look like totals/tax/subtotal
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes('subtotal') ||
      lowerName.includes('total') ||
      lowerName.includes('tax') ||
      lowerName.includes('change') ||
      lowerName.includes('cash') ||
      lowerName.includes('credit') ||
      lowerName.includes('debit') ||
      lowerName.includes('balance') ||
      lowerName.includes('payment') ||
      name.length < 2
    ) {
      continue;
    }

    items.push({
      id: `item-${++idCounter}`,
      name: cleanItemName(name),
      quantity,
      unitPrice: price / quantity,
      totalPrice: price,
      confidence: 0.85,
    });
  }

  // Extract totals
  let total = 0;
  let tax = 0;
  let subtotal = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    const valMatch = line.match(/\$?\s*(\d{1,5}\.\d{2})/);
    if (!valMatch) continue;
    const val = parseFloat(valMatch[1]);
    if (lower.includes('total') && !lower.includes('sub')) {
      total = Math.max(total, val);
    }
    if (lower.includes('subtotal') || lower.includes('sub total')) {
      subtotal = val;
    }
    if (lower.includes('tax')) {
      tax = val;
    }
  }

  if (total === 0) {
    total = items.reduce((sum, i) => sum + i.totalPrice, 0);
  }
  if (subtotal === 0) {
    subtotal = total - tax;
  }

  return {
    storeName,
    storeAddress,
    location,
    zipCode,
    phone: '',
    date,
    dateTime: date,
    coordinates: '',
    items,
    subtotal,
    tax,
    total,
    rawText,
  };
}

function cleanItemName(name: string): string {
  // Remove common receipt artifacts
  return name
    .replace(/[^a-zA-Z0-9\s\/\-().%]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractZipCode(text: string): string | undefined {
  const match = text.match(/\b\d{5}(?:-\d{4})?\b/);
  return match?.[0];
}

function extractAddress(lines: string[]): string {
  const streetSuffixRegex = /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|hwy|highway|pkwy|parkway|way)\b/i;
  const candidate = lines.find((line) => {
    const hasNumber = /\d/.test(line);
    return hasNumber && streetSuffixRegex.test(line) && line.length > 8;
  });

  return candidate || '';
}

function extractLocation(lines: string[], storeAddress: string): string {
  const stateZipRegex = /\b([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\b/;
  for (const line of lines) {
    const match = line.match(stateZipRegex);
    if (match) {
      const city = match[1].trim();
      const state = match[2];
      return `${city}, ${state}`;
    }
  }

  if (storeAddress) {
    const parts = storeAddress.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts.slice(1, 3).join(', ');
    }
  }

  return '';
}

export async function inferZipCodeFromAddress(address: string): Promise<string | undefined> {
  const normalized = String(address || '').trim();
  if (!normalized) return undefined;

  const existingZip = extractZipCode(normalized);
  if (existingZip) return existingZip;

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(normalized)}`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) return undefined;

    const results = (await response.json()) as Array<{ address?: { postcode?: string } }>;
    const postcode = results?.[0]?.address?.postcode;
    if (!postcode) return undefined;

    const match = postcode.match(/\d{5}(?:-\d{4})?/);
    return match?.[0];
  } catch {
    return undefined;
  }
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const normalized = String(address || '').trim();
  if (!normalized) return null;

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(normalized)}`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) return null;

    const results = (await response.json()) as Array<{ lat: string; lon: string }>;
    const hit = results?.[0];
    if (!hit) return null;

    const lat = Number.parseFloat(hit.lat);
    const lng = Number.parseFloat(hit.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
