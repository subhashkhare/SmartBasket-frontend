import { useState, useRef, useCallback } from 'react';
import { Camera, CheckCircle2, RotateCcw, ImageIcon, Trash2, Plus } from 'lucide-react';
import {
  extractReceiptData,
  geocodeAddress,
  inferZipCodeFromAddress,
  ParsedReceipt,
  ParsedReceiptItem,
} from '@/lib/ocr';
import { apiService } from '@/lib/api';

type ScanState = 'idle' | 'processing' | 'done';

// Circumference of the SVG progress ring (r=36)
const RING_CIRCUMFERENCE = 2 * Math.PI * 36;

const ScannerView = () => {
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

  const updateItemName = (id: string, val: string) =>
    setReceipt((r) =>
      r && { ...r, items: r.items.map((i) => (i.id === id ? { ...i, name: val } : i)) }
    );

  const updateItemPrice = (id: string, val: string) => {
    const price = parseFloat(val) || 0;
    setReceipt((r) =>
      r &&
      {
        ...r,
        items: r.items.map((i) =>
          i.id === id
            ? { ...i, unitPrice: price, totalPrice: price * i.quantity }
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
      .replaceAll(/[^a-z0-9\s-]/g, '')
      .trim()
      .replaceAll(/\s+/g, '-') || `store-${Date.now()}`;

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
      lat: geo?.lat ?? 37.7749,
      lng: geo?.lng ?? -122.4194,
      chainId: buildChainId(storeName),
      isMembership: false,
    });

    if (createResult.error || !createResult.data?._id)
      throw new Error(createResult.error || 'Unable to create store');

    return createResult.data._id;
  };

  const getUserKey = (): string => {
    try {
      const s = localStorage.getItem('smartCartSession') || localStorage.getItem('smartCartUser');
      if (s) {
        const p = JSON.parse(s);
        return p.phoneNumber || p.id || p.email || 'unknown';
      }
    } catch {}
    return 'unknown';
  };

  const handleSave = async () => {
    if (!receipt) return;

    const validItems = receipt.items
      .map((i) => ({ itemName: String(i.name || '').trim(), unitPrice: Number(i.unitPrice || 0) }))
      .filter((i) => i.itemName.length > 0 && i.unitPrice > 0);

    if (validItems.length === 0) {
      setError('Add at least one item with a name and price.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSaveMessage(null);
      setDuplicateAlert(false);

      const receiptDate = receipt.dateTime || receipt.date || null;
      const storeId = await resolveStoreId();
      const result = await apiService.upsertReceiptItemsByStore(storeId, validItems, receiptDate);
      if (result.error) { setError(result.error); return; }

      if (result.data?.alreadyExists) {
        setDuplicateAlert(true);
        return;
      }

      // Save to local receipt history
      try {
        const HISTORY_KEY = 'smartCartReceiptHistory';
        const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        history.push({
          id: `receipt-${Date.now()}`,
          userKey: getUserKey(),
          storeName: receipt.storeName || 'Unknown Store',
          date: new Date().toISOString().slice(0, 10),
          total: receipt.items.reduce((s, i) => s + i.totalPrice, 0),
          savings: 0,
          status: 'verified',
        });
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch {}

      setSaveMessage(`Saved ${result.data?.updated ?? 0} items successfully.`);
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
          <div className="relative w-full aspect-[3/4] rounded-2xl border-2 border-dashed border-border bg-muted/30 overflow-hidden flex items-center justify-center mb-4">

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
                <p className="text-sm font-semibold text-foreground">Scan a receipt</p>
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
            <div className="flex gap-3">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <Camera size={18} />
                Take Photo
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 h-12 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
              >
                <ImageIcon size={18} />
                Upload
              </button>
            </div>
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
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground w-full"
              />
            </div>
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <label className="text-xs text-muted-foreground font-medium">Zip Code</label>
              <input
                value={receipt.zipCode || ''}
                onChange={(e) => updateZipCode(e.target.value)}
                placeholder="Zip code"
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground w-full"
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
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 w-24">Price ($)</th>
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
                        className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
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
                        className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground text-right"
                      />
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
