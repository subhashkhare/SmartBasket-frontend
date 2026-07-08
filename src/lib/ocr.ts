import corePath from 'tesseract.js-core/tesseract-core.wasm.js?url';
import Anthropic from '@anthropic-ai/sdk';

const workerPath = '/tesseract.worker.js';
const CLAUDE_API_KEY = import.meta.env.VITE_CLAUDE_API_KEY;

export interface ParsedReceiptItem {
  id: string;
  name: string;
  itemType?: string;
  quantity: number;
  quantityLabel: string;
  unitPrice: number;
  totalPrice: number;
  confidence: number;
}

export interface ParsedReceipt {
  storeName: string;
  storeAddress: string;
  location: string;
  city?: string;
  state?: string;
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
    city: '',
    state: '',
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
      city: parsed.city || fallback.city,
      state: parsed.state || fallback.state,
      zipCode: parsed.zipCode || fallback.zipCode,
      phone: parsed.phone || fallback.phone,
      dateTime: parsed.dateTime || fallback.dateTime,
      coordinates: parsed.coordinates || fallback.coordinates,
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter((item: any) => item.name && String(item.name).trim().length > 0)
            .map((item: any) => {
              const qty = Math.max(0.001, Number(item.quantity) || 1);
              const total = Number(item.totalPrice) || 0;
              return {
                name: String(item.name).trim(),
                itemType: String(item.itemType || '').trim(),
                quantityLabel: item.quantityLabel || String(item.quantity ?? 1),
                quantity: qty,
                unitPrice: parseFloat((total / qty).toFixed(2)),
                totalPrice: total,
              };
            })
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
          quantityLabel: '1',
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

    // convertImageToBase64 always outputs JPEG after canvas compression
    const mediaType = 'image/jpeg' as const;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
              text: `You are a receipt data extractor. Look at the receipt image and extract ONLY data that is literally printed and visible on the receipt. Do not infer, guess, or fabricate any data. If a field is not visible on the receipt, use "" or 0.

Return strict JSON only, no explanation:

{
  "storeName": "",
  "storeAddress": "",
  "city": "",
  "state": "",
  "zipCode": "",
  "phone": "",
  "dateTime": "",
  "location": "",
  "items": [
    {
      "name": "",
      "itemType": "",
      "quantityLabel": "1",
      "quantity": 1,
      "unitPrice": 0.00,
      "totalPrice": 0.00
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00
}

Rules:
- ONLY extract what is physically printed on the receipt. Never invent or estimate missing values.
- items: only actual purchased items. Exclude total lines, tax lines, payment lines, and receipt codes.
- name: full item name exactly as printed on the receipt.
- itemType: the generic product category, stripped of brand names AND descriptive variety/color/ripeness modifiers, so the same underlying product groups together regardless of brand or variety (e.g. "Amul Ghee" → itemType "Ghee"; "Haldiram Aloo Bhujia 1kg" → itemType "Aloo Bhujia 1kg"; "Organic Banana" → itemType "Banana"; "Orange Bell Pepper /lb" → itemType "Bell Pepper (LB)"; "Red Delicious Apple" → itemType "Apple"). Keep suffixes that are core to the product identity (e.g. "2%" milk, "1kg"). For per-pound/weighed items, append the unit in parentheses as "(LB)" (uppercase, single space before the parenthesis, no other suffix). If there is no brand or descriptive modifier to strip, use the same value as name.
- quantityLabel: exactly as printed on the receipt (e.g. "1.43 lb", "400 g", "2"). Use "1" for a plain single-unit item.
- quantity: numeric value (e.g. 1.43 for "1.43 lb", 2 for "2 items", 1 for a single package).
- unitPrice: price per unit as printed. If not printed, compute totalPrice / quantity.
- totalPrice: line total as printed on the receipt.
- For weighted items (e.g. "1.43 lb @ $0.99/lb"): quantityLabel="1.43 lb", quantity=1.43, unitPrice=0.99.
- For package-weight items (e.g. "ITEM 400G $4.49"): quantityLabel="400 g", quantity=1, unitPrice=4.49.
- For multi-pack (e.g. "2 WHEAT ROTI $4.99 ea"): quantityLabel="2", quantity=2, unitPrice=4.99.
- Return valid JSON only.`,
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
        city: parsedData.city || ocrParsed.city || '',
        state: parsedData.state || ocrParsed.state || '',
        zipCode: parsedData.zipCode || ocrParsed.zipCode,
        phone: parsedData.phone || ocrParsed.phone || '',
        date: parsedData.dateTime || ocrParsed.date,
        dateTime: parsedData.dateTime || ocrParsed.date,
        coordinates: parsedData.coordinates || ocrParsed.coordinates || '',
        rawText: responseText || rawText,
      };
    }

    // Validate and clean the response — never substitute invented values
    const receipt: ParsedReceipt = {
      storeName: parsedData.storeName || '',
      storeAddress: parsedData.storeAddress || '',
      location: parsedData.location || '',
      city: parsedData.city || '',
      state: parsedData.state || '',
      zipCode: parsedData.zipCode,
      phone: parsedData.phone || '',
      date: parsedData.dateTime || '',
      dateTime: parsedData.dateTime || '',
      coordinates: '',
      items: (parsedData.items || [])
        .filter((item: any) => item.name && String(item.name).trim().length > 0)
        .map((item: any, index: number) => {
          const qty = Math.max(0.001, parseFloat(item.quantity) || 1);
          const total = parseFloat(item.totalPrice) || 0;
          return {
            id: `item-${index + 1}`,
            name: String(item.name).trim(),
            itemType: String(item.itemType || '').trim(),
            quantityLabel: item.quantityLabel || String(item.quantity ?? 1),
            quantity: qty,
            unitPrice: parseFloat((total / qty).toFixed(2)),
            totalPrice: total,
            confidence: 0.95,
          };
        }),
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
    const response = await fetch(image);
    blob = await response.blob();
  } else {
    blob = image;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 2000;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width >= height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.92).replace(/^data:image\/jpeg;base64,/, ''));
    };
    img.onerror = reject;
    img.src = url;
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
    const firstLine = lines[0].trim();
    // Only use first line if it looks like a store name (letters, not a price or address)
    if (firstLine.length >= 3 && !/^\d/.test(firstLine) && !/\$/.test(firstLine)) {
      storeName = firstLine.substring(0, 40);
    } else {
      storeName = '';
    }
  }

  const zipCode = extractZipCode(lines.join(' '));
  const storeAddress = extractAddress(lines);
  const location = extractLocation(lines, storeAddress);
  const { city, state } = extractCityState(lines);

  // Try to find a date (MM/DD/YYYY or MM-DD-YYYY patterns) — leave empty if not found
  let date = '';
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
      quantityLabel: String(quantity),
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
    city,
    state,
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

function extractCityState(lines: string[]): { city: string; state: string } {
  const stateZipRegex = /\b([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\b/;
  for (const line of lines) {
    const match = line.match(stateZipRegex);
    if (match) {
      return { city: match[1].trim(), state: match[2] };
    }
  }
  return { city: '', state: '' };
}

export async function inferCityStateFromZip(zipCode: string): Promise<{ city: string; state: string } | null> {
  const trimmed = String(zipCode || '').trim();
  if (!/^\d{5}$/.test(trimmed)) return null;

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&postalcode=${encodeURIComponent(trimmed)}&countrycodes=us`,
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) return null;

    const results = (await response.json()) as Array<{
      address?: {
        city?: string;
        town?: string;
        village?: string;
        county?: string;
        state?: string;
        'ISO3166-2-lvl4'?: string;
      };
    }>;

    const addr = results?.[0]?.address;
    if (!addr) return null;

    const city = addr.city || addr.town || addr.village || addr.county || '';
    // Nominatim returns full state name; extract 2-letter code from ISO3166-2 tag (e.g. "US-CA" → "CA")
    const isoTag = addr['ISO3166-2-lvl4'] || '';
    const state = isoTag.split('-')[1] || '';

    return city || state ? { city, state } : null;
  } catch {
    return null;
  }
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
