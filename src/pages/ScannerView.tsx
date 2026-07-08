import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, RotateCcw, ImageIcon, Trash2, Plus } from 'lucide-react';
import {
  extractReceiptData,
  geocodeAddress,
  inferZipCodeFromAddress,
  inferCityStateFromZip,
  ParsedReceipt,
  ParsedReceiptItem,
} from '@/lib/ocr';
import { apiService } from '@/lib/api';

type ScanState = 'idle' | 'processing' | 'done';

const toTitleCase = (str: string) =>
  str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Circumference of the SVG progress ring (r=36)
const RING_CIRCUMFERENCE = 2 * Math.PI * 36;

const ScannerView = () => {
  const navigate = useNavigate();
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [progress, setProgress] = useState(0);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [duplicateAlert, setDuplicateAlert] = useState(false);
  const [scanMethod, setScanMethod] = useState<'claude' | 'ocr'>('ocr');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(async (file: File) => {
    setError(null);
    setSaveMessage(null);
    setScanState('processing');
    setProgress(0);
    setPreviewUrl(URL.createObjectURL(file));

    const claudeApiKey = import.meta.env.VITE_CLAUDE_API_KEY;
    const willUseClaude =
      claudeApiKey &&
      claudeApiKey !== 'your_claude_api_key_here' &&
      !claudeApiKey.includes('your_');
    setScanMethod(willUseClaude ? 'claude' : 'ocr');

    try {
      const parsed = await extractReceiptData(file, (p) => setProgress(p));

      if (!parsed.zipCode && parsed.storeAddress) {
        const inferredZip = await inferZipCodeFromAddress(parsed.storeAddress);
        if (inferredZip) parsed.zipCode = inferredZip;
      }

      // Normalise to Title Case for display
      parsed.storeName = toTitleCase(parsed.storeName || '');
      parsed.storeAddress = toTitleCase(parsed.storeAddress || '');
      parsed.items = parsed.items.map((item) => ({
        ...item,
        name: toTitleCase(item.name || ''),
      }));

      setReceipt(parsed);
      setScanState('done');
    } catch (err) {
      console.error('Receipt processing failed:', err);
      setError('Failed to process receipt. Please try a clearer image.');
      setScanState('idle');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImage(file);
    e.target.value = '';
  };

  const handleReset = () => {
    setScanState('idle');
    setReceipt(null);
    setPreviewUrl(null);
    setProgress(0);
    setError(null);
    setSaveMessage(null);
    setDuplicateAlert(false);
    setSaving(false);
  };

  const updateStoreName = (val: string) =>
    setReceipt((r) => r && { ...r, storeName: val });

  const updateZipCode = (val: string) =>
    setReceipt((r) => r && { ...r, zipCode: val });

  const handleZipBlur = async (zip: string) => {
    const trimmed = zip.trim();
    if (!/^\d{5}$/.test(trimmed)) return;
    const result = await inferCityStateFromZip(trimmed);
    if (result) {
      setReceipt((r) => r && { ...r, city: result.city, state: result.state });
    }
  };

  const updateItemName = (id: string, val: string) =>
    setReceipt((r) =>
      r && { ...r, items: r.items.map((i) => (i.id === id ? { ...i, name: val } : i)) }
    );

  const updateItemQuantity = (id: string, val: string) => {
    const numericQty = parseFloat(val) || 1;
    setReceipt((r) =>
      r && {
        ...r,
        items: r.items.map((i) =>
          i.id === id
            ? { ...i, quantityLabel: val, quantity: numericQty, totalPrice: parseFloat((i.unitPrice * numericQty).toFixed(2)) }
            : i
        ),
      }
    );
  };

  const updateItemPrice = (id: string, val: string) => {
    const price = parseFloat(val) || 0;
    setReceipt((r) =>
      r &&
      {
        ...r,
        items: r.items.map((i) =>
          i.id === id
            ? { ...i, unitPrice: price, totalPrice: parseFloat((price * i.quantity).toFixed(2)) }
            : i
        ),
      }
    );
  };

  const removeItem = (id: string) =>
    setReceipt((r) => r && { ...r, items: r.items.filter((i) => i.id !== id) });

  const addBlankRow = () => {
    const blank: ParsedReceiptItem = {
      id: `manual-${Date.now()}`,
      name: '',
      quantityLabel: '1',
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
      confidence: 1,
    };
    setReceipt((r) => r && { ...r, items: [...r.items, blank] });
  };

  const buildChainId = (storeName: string) =>
    String(storeName || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || `store-${Date.now()}`;

  const resolveStoreId = async (): Promise<string> => {
    if (!receipt) throw new Error('No receipt data');
    const storeName = String(receipt.storeName || '').trim();
    const storeAddress = String(receipt.storeAddress || '').trim();
    const zipCode = String(receipt.zipCode || '').trim();
    if (!storeName) throw new Error('Store name is required');

    const storesResult = await apiService.getStores();
    if (storesResult.error) throw new Error(storesResult.error);

    const existing = (storesResult.data || []).find(
      (s) =>
        s.name.toLowerCase() === storeName.toLowerCase() &&
        (zipCode ? String(s.zipCode || '').trim() === zipCode : true)
    );
    if (existing?._id) return existing._id;

    const geo = await geocodeAddress(
      storeAddress || `${storeName} ${receipt.location || ''} ${zipCode}`.trim()
    );

    const createResult = await apiService.createStore({
      name: storeName,
      address: storeAddress || receipt.location || 'Unknown Address',
      zipCode: zipCode || '00000',
      city: receipt.city || '',
      state: receipt.state || '',
      lat: geo?.lat ?? 37.7749,
      lng: geo?.lng ?? -122.4194,
      chainId: buildChainId(storeName),
      isMembership: false,
    });

    if (createResult.error || !createResult.data?._id)
      throw new Error(createResult.error || 'Unable to create store');

    return createResult.data._id;
  };

  const handleSave = async () => {
    if (!receipt) return;

    const validItems = receipt.items
      .filter((i) => String(i.name || '').trim().length > 0 && i.unitPrice > 3)
      .map((i) => ({
        itemName:      String(i.name).trim().toLowerCase(),
        itemType:      String(i.itemType || '').trim(),
        quantity:      Number(i.quantity) || 1,
        quantityLabel: i.quantityLabel ?? String(i.quantity ?? 1),
        unitPrice:     parseFloat(Number(i.unitPrice).toFixed(2)),
        totalPrice:    parseFloat(Number(i.totalPrice).toFixed(2)),
      }));

    if (validItems.length === 0) {
      setError('Add at least one item with a name and unit price over $3.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSaveMessage(null);
      setDuplicateAlert(false);

      const storeId = await resolveStoreId();
      const receiptDate = receipt.dateTime || receipt.date || null;
      const receiptTotal = receipt.total || validItems.reduce((s, i) => s + i.totalPrice, 0);

      const result = await apiService.saveReceipt({
        storeId,
        storeName: (receipt.storeName || 'unknown store').toLowerCase(),
        city:  receipt.city  || '',
        state: receipt.state || '',
        zipCode: receipt.zipCode || '',
        receiptDate,
        items: validItems,
        subtotal: receipt.subtotal || 0,
        tax:      receipt.tax      || 0,
        total:    receiptTotal,
      });

      if (result.error) { setError(result.error); return; }
      if (result.data?.alreadyExists) { setDuplicateAlert(true); return; }

      try {
        const s = localStorage.getItem('smartCartSession') || localStorage.getItem('smartCartUser');
        const userKey = s ? (JSON.parse(s).phoneNumber || JSON.parse(s).id || '') : '';
        localStorage.setItem('smartCartLastScan', JSON.stringify({ userKey, timestamp: new Date().toISOString() }));
      } catch { /* ignore storage errors */ }

      setSaveMessage(`Saved ${validItems.length} items successfully.`);
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-foreground mb-1 pt-2">Scan Receipt</h1>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />

      {/* ── SCANNER PLACEHOLDER (idle + processing) ── */}
      {scanState !== 'done' && (
        <div className="mt-4">
          {/* Placeholder / preview box */}
          <div
            className={`relative w-full aspect-[3/4] rounded-2xl border-2 border-dashed border-border bg-muted/30 overflow-hidden flex items-center justify-center mb-4${scanState === 'idle' ? ' cursor-pointer hover:border-primary/60 hover:bg-muted/50 transition-colors active:scale-[0.99]' : ''}`}
            onClick={scanState === 'idle' ? () => cameraInputRef.current?.click() : undefined}
          >

            {/* Idle: scanner graphic */}
            {scanState === 'idle' && (
              <div className="flex flex-col items-center gap-3 select-none">
                {/* Corner guides */}
                <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-primary/50 rounded-tl-lg" />
                <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-primary/50 rounded-tr-lg" />
                <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-primary/50 rounded-bl-lg" />
                <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-primary/50 rounded-br-lg" />

                <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Camera size={36} className="text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Tap to scan a receipt</p>
                <p className="text-xs text-muted-foreground text-center px-8">
                  Take a photo or upload an image to extract items and prices
                </p>
              </div>
            )}

            {/* Processing: image + circular spinner overlay */}
            {scanState === 'processing' && (
              <>
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Receipt being scanned"
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                )}
                {/* Dark overlay */}
                <div className="absolute inset-0 bg-black/50" />
                {/* Circular progress */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="relative w-24 h-24">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                      {/* Track */}
                      <circle
                        cx="40" cy="40" r="36"
                        fill="none"
                        stroke="rgba(255,255,255,0.2)"
                        strokeWidth="6"
                      />
                      {/* Progress arc */}
                      <circle
                        cx="40" cy="40" r="36"
                        fill="none"
                        stroke="white"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress / 100)}
                        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                      />
                    </svg>
                    {/* Percentage label in the centre */}
                    <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg">
                      {progress}%
                    </span>
                  </div>
                  <p className="text-white text-sm font-semibold drop-shadow">
                    {scanMethod === 'claude' ? 'Scanning with Claude AI…' : 'Processing with OCR…'}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Buttons — only shown when idle */}
          {scanState === 'idle' && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-12 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
            >
              <ImageIcon size={18} />
              Upload Image
            </button>
          )}
        </div>
      )}

      {/* ── DONE ── */}
      {scanState === 'done' && receipt && (
        <div className="mt-4 space-y-4">
          {/* Store fields */}
          <div className="ios-card space-y-3">
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <label className="text-xs text-muted-foreground font-medium">Store Name</label>
              <input
                value={receipt.storeName || ''}
                onChange={(e) => updateStoreName(e.target.value)}
                placeholder="Store name"
                className="rounded-lg border border-input bg-background px-3 py-2 text-[0.7rem] text-foreground w-full"
              />
            </div>
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <label className="text-xs text-muted-foreground font-medium">Zip Code</label>
              <input
                value={receipt.zipCode || ''}
                onChange={(e) => updateZipCode(e.target.value)}
                onBlur={(e) => { void handleZipBlur(e.target.value); }}
                placeholder="Zip code"
                className="rounded-lg border border-input bg-background px-3 py-2 text-[0.7rem] text-foreground w-full"
              />
            </div>
          </div>

          {/* Items table */}
          <div className="ios-card overflow-x-auto">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Items
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-2">Item Name</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 w-16">Qty</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 w-24">Price/Unit</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 w-24">Total Price</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2">
                      <input
                        value={item.name}
                        onChange={(e) => updateItemName(item.id, e.target.value)}
                        placeholder="Item name"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-[0.7rem] text-foreground"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={item.quantityLabel ?? String(item.quantity)}
                        onChange={(e) => updateItemQuantity(item.id, e.target.value)}
                        placeholder="1"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-[0.7rem] text-foreground text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitPrice || ''}
                        onChange={(e) => updateItemPrice(item.id, e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-[0.7rem] text-foreground text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2 text-right text-[0.7rem] font-medium text-foreground whitespace-nowrap">
                      ${item.totalPrice.toFixed(2)}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-destructive hover:bg-destructive/10 rounded p-1"
                        aria-label="Remove item"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button
              onClick={addBlankRow}
              className="mt-3 flex items-center gap-1.5 text-xs text-primary font-semibold hover:opacity-80 transition-opacity"
            >
              <Plus size={14} />
              Add Row
            </button>
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">{error}</div>
          )}
          {duplicateAlert && (
            <div className="p-3 rounded-xl bg-warning/10 border border-warning/30 text-warning text-sm font-medium">
              Data already updated
            </div>
          )}
          {saveMessage && (
            <div className="p-3 rounded-xl bg-success/10 text-success text-sm flex items-center gap-2">
              <CheckCircle2 size={16} />
              {saveMessage}
            </div>
          )}

          {/* Action buttons */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={18} />
            {saving ? 'Saving...' : 'Save to Database'}
          </button>
          <button
            onClick={handleReset}
            className="w-full h-10 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
          >
            <RotateCcw size={16} />
            Scan Another
          </button>
        </div>
      )}
    </div>
  );
};

export default ScannerView;
