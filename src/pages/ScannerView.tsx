import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, CheckCircle2, RotateCcw, ImageIcon, Trash2 } from 'lucide-react';
import {
  extractReceiptData,
  geocodeAddress,
  inferZipCodeFromAddress,
  ParsedReceipt,
  ParsedReceiptItem,
} from '@/lib/ocr';
import { apiService } from '@/lib/api';

type ScanState = 'idle' | 'processing' | 'done';

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 items-start">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

const ScannerView = () => {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [progress, setProgress] = useState(0);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [scanMethod, setScanMethod] = useState<'claude' | 'ocr'>('ocr');
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [manualItemQuantity, setManualItemQuantity] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(async (file: File) => {
    setError(null);
    setScanState('processing');
    setProgress(0);

    // Determine which scanning method will be used
    const claudeApiKey = import.meta.env.VITE_CLAUDE_API_KEY;
    const willUseClaude = claudeApiKey && claudeApiKey !== 'your_claude_api_key_here' && !claudeApiKey.includes('your_');
    setScanMethod(willUseClaude ? 'claude' : 'ocr');

    // Create preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    try {
      const parsed = await extractReceiptData(file, (p) => setProgress(p));

      if (!parsed.zipCode && parsed.storeAddress) {
        const inferredZip = await inferZipCodeFromAddress(parsed.storeAddress);
        if (inferredZip) {
          parsed.zipCode = inferredZip;
        }
      }

      if (parsed.items.length === 0) {
        // If no items parsed, still show raw text for manual entry
        setReceipt({ ...parsed, items: [] });
      } else {
        setReceipt(parsed);
      }
      setScanState('done');
    } catch (err) {
      console.error('Receipt processing failed:', err);
      setError('Failed to process receipt. Please try a clearer image.');
      setScanState('idle');
      setPreviewUrl(null);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImage(file);
    e.target.value = '';
  };

  const removeReceiptItem = (itemId: string) => {
    setReceipt((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.filter((item) => item.id !== itemId),
      };
    });
  };

  const handleReset = () => {
    setScanState('idle');
    setReceipt(null);
    setPreviewUrl(null);
    setProgress(0);
    setError(null);
    setSaveMessage(null);
    setSaving(false);
    setScanMethod('ocr');
  };

  const buildChainId = (storeName: string) => {
    const normalized = String(storeName || '')
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s-]/g, '')
      .trim()
      .replaceAll(/\s+/g, '-');

    return normalized || `store-${Date.now()}`;
  };

  const resolveStoreId = async (): Promise<string> => {
    if (!receipt) {
      throw new Error('No receipt data to save');
    }

    const storeName = String(receipt.storeName || '').trim();
    const storeAddress = String(receipt.storeAddress || '').trim();
    const zipCode = String(receipt.zipCode || '').trim();

    if (!storeName) {
      throw new Error('Store name is required');
    }

    const storesResult = await apiService.getStores();
    if (storesResult.error) {
      throw new Error(storesResult.error);
    }

    const existing = (storesResult.data || []).find((store) => {
      const nameMatch = store.name.toLowerCase() === storeName.toLowerCase();
      const zipMatch = zipCode ? String(store.zipCode || '').trim() === zipCode : true;
      return nameMatch && zipMatch;
    });

    if (existing?._id) {
      return existing._id;
    }

    const geo = await geocodeAddress(storeAddress || `${storeName} ${receipt.location || ''} ${zipCode}`.trim());
    const lat = geo?.lat ?? 37.7749;
    const lng = geo?.lng ?? -122.4194;

    const createStoreResult = await apiService.createStore({
      name: storeName,
      address: storeAddress || receipt.location || 'Unknown Address',
      zipCode: zipCode || '00000',
      lat,
      lng,
      chainId: buildChainId(storeName),
      isMembership: false,
    });

    if (createStoreResult.error || !createStoreResult.data?._id) {
      throw new Error(createStoreResult.error || 'Unable to create store');
    }

    return createStoreResult.data._id;
  };

  const getUserKeyForReceipt = (): string => {
    try {
      const session = localStorage.getItem('smartCartSession');
      if (session) {
        const parsed = JSON.parse(session);
        return parsed.phoneNumber || parsed.id || parsed.email || 'unknown';
      }
      const user = localStorage.getItem('smartCartUser');
      if (user) {
        const parsed = JSON.parse(user);
        return parsed.phoneNumber || parsed.id || parsed.email || 'unknown';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const saveReceiptToHistory = () => {
    try {
      const RECEIPT_HISTORY_KEY = 'smartCartReceiptHistory';
      const userKey = getUserKeyForReceipt();

      let history = [];
      try {
        const data = localStorage.getItem(RECEIPT_HISTORY_KEY);
        if (data) {
          history = JSON.parse(data);
          if (!Array.isArray(history)) history = [];
        }
      } catch {
        history = [];
      }

      const today = new Date().toISOString().slice(0, 10);
      const newEntry = {
        id: `receipt-${Date.now()}`,
        userKey,
        storeName: receipt.storeName || 'Unknown Store',
        date: today,
        total: itemsTotal,
        savings: 0,
        status: 'verified' as const,
      };

      history.push(newEntry);
      localStorage.setItem(RECEIPT_HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.error('Failed to save receipt to history:', err);
    }
  };

  const handleSaveToDatabase = async () => {
    if (!receipt) return;

    const validItems = receipt.items
      .map((item) => ({
        itemName: String(item.name || '').trim(),
        unitPrice: Number(item.unitPrice || 0),
      }))
      .filter((item) => item.itemName.length > 0 && item.unitPrice > 0);

    if (validItems.length === 0) {
      setError('Add at least one valid item with a unit price to update the database.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSaveMessage(null);

      const storeId = await resolveStoreId();
      const updateResult = await apiService.upsertReceiptItemsByStore(storeId, validItems);
      if (updateResult.error) {
        setError(updateResult.error);
        return;
      }

      const updated = updateResult.data?.updated || 0;
      
      // Save receipt to user's history
      saveReceiptToHistory();
      
      setSaveMessage(`Database updated successfully: ${updated} items saved.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update database';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const itemsTotal = receipt?.items.reduce((s, i) => s + i.totalPrice, 0) ?? 0;

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-foreground mb-1 pt-2">Scan Receipt</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {scanState === 'idle' && 'Take a photo or upload a receipt image'}
        {scanState === 'processing' && 'Reading your receipt...'}
        {scanState === 'done' && 'Review scanned data and save to database'}
      </p>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Image Preview / Capture Area */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative aspect-[3/4] rounded-2xl bg-foreground/5 border-2 border-dashed border-border overflow-hidden mb-6 flex items-center justify-center"
      >
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Receipt preview"
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}

        {scanState === 'idle' && !previewUrl && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Camera size={28} className="text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Capture or upload a receipt</p>
            <p className="text-xs text-muted-foreground mt-1">Supports photos of thermal receipts</p>
          </div>
        )}

        {scanState === 'processing' && (
          <div className="absolute inset-0 bg-foreground/60 flex items-center justify-center">
            <div className="text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-10 h-10 border-3 border-primary-foreground border-t-transparent rounded-full mx-auto mb-3"
                style={{ borderWidth: 3 }}
              />
              <p className="text-sm font-semibold text-primary-foreground">
                {scanMethod === 'claude' ? 'Scanning using Claude...' : 'Processing with OCR...'}
              </p>
              <p className="text-xs text-primary-foreground/70 mt-1">{progress}% complete</p>
              {/* Progress bar */}
              <div className="w-48 h-1.5 bg-primary-foreground/20 rounded-full mt-3 mx-auto overflow-hidden">
                <motion.div
                  className="h-full bg-primary-foreground rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          </div>
        )}

        {scanState === 'done' && !previewUrl && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center"
          >
            <CheckCircle2 size={48} className="text-success mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">Receipt Processed!</p>
          </motion.div>
        )}

        {scanState === 'done' && previewUrl && (
          <div className="absolute inset-0 bg-foreground/30 flex items-end justify-center pb-4">
            <div className="savings-badge text-xs">
              <CheckCircle2 size={12} className="mr-1" />
              {receipt?.items.length ?? 0} items detected
            </div>
          </div>
        )}

        {/* Corner guides */}
        {scanState === 'idle' && !previewUrl && (
          <>
            <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-primary/40 rounded-tl-lg" />
            <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-primary/40 rounded-tr-lg" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-primary/40 rounded-bl-lg" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-primary/40 rounded-br-lg" />
          </>
        )}
      </motion.div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      {saveMessage && (
        <div className="mb-4 p-3 rounded-xl bg-success/10 text-success text-sm">
          {saveMessage}
        </div>
      )}

      {/* Action Buttons */}
      {scanState === 'idle' && (
        <div className="flex gap-3">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 tap-highlight active:scale-[0.97] transition-transform"
          >
            <Camera size={18} />
            Take Photo
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-12 px-5 rounded-xl bg-secondary flex items-center justify-center gap-2 tap-highlight active:scale-[0.97] transition-transform"
          >
            <ImageIcon size={18} className="text-secondary-foreground" />
            <span className="text-sm font-semibold text-secondary-foreground">Upload</span>
          </button>
        </div>
      )}

      {scanState === 'done' && (
        <button
          onClick={handleReset}
          className="w-full h-10 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm flex items-center justify-center gap-2 tap-highlight active:scale-[0.97] transition-transform mb-4"
        >
          <RotateCcw size={16} />
          Scan Another Receipt
        </button>
      )}

      {/* Detected Items / Verification UI */}
      {scanState === 'done' && receipt && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          {/* Store & Receipt details - Read Only */}
          <div className="ios-card mb-3">
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] mb-2">FieldInfo</p>
                <div className="grid gap-2">
                  <DetailRow label="Store Name" value={receipt.storeName || 'Not detected'} />
                  <DetailRow label="Address" value={receipt.storeAddress || 'Not detected'} />
                  <DetailRow label="ZIP" value={receipt.zipCode || 'Not detected'} />
                  <DetailRow label="Phone" value={receipt.phone || 'Not detected'} />
                  <DetailRow label="Date & Time" value={receipt.dateTime || receipt.date || 'Not detected'} />
                  {receipt.coordinates && <DetailRow label="Coordinates" value={receipt.coordinates} />}
                </div>
              </div>
            </div>
          </div>

          {/* Item list - Read Only */}
          <div className="flex items-center justify-between mb-2">
            <p className="section-title mb-0">Grocery Items & Pricing</p>
            <p className="text-xs text-muted-foreground">#Item  Unit Price</p>
          </div>

          <div className="space-y-2 mb-4">
            <AnimatePresence>
              {receipt.items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  className={`ios-card ${item.confidence < 0.7 ? 'border border-warning/30' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Qty {item.quantity} × ${item.unitPrice.toFixed(3)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-foreground">
                        ${item.totalPrice.toFixed(2)}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeReceiptItem(item.id)}
                        className="rounded-full p-2 text-destructive hover:bg-destructive/10"
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {item.confidence < 0.7 && (
                    <div className="text-[10px] text-warning px-2 py-1 rounded bg-warning/10 mt-2 inline-block">
                      Low confidence
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {receipt.items.length === 0 && (
              <div className="ios-card text-center py-6">
                <p className="text-sm text-muted-foreground mb-2">No items detected</p>
                <p className="text-xs text-muted-foreground">Try a clearer image or different receipt</p>
              </div>
            )}
          </div>

          {/* Raw OCR text (collapsible) */}
          {/* <details className="mb-4">
            <summary className="text-xs text-muted-foreground cursor-pointer tap-highlight">
              View raw OCR text
            </summary>
            <pre className="mt-2 p-3 rounded-xl bg-secondary text-[10px] text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
              {receipt.rawText || 'No text extracted'}
            </pre>
          </details> */}

          {/* Save button */}
          <div className="ios-card mb-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] mb-3">Add item manually</p>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <label className="text-[10px] text-muted-foreground">Item name</label>
                <input
                  value={manualItemName}
                  onChange={(e) => setManualItemName(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                  placeholder="e.g. Organic Milk"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-[10px] text-muted-foreground">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={manualItemQuantity}
                    onChange={(e) => setManualItemQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-[10px] text-muted-foreground">Unit price</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={manualItemPrice}
                    onChange={(e) => setManualItemPrice(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                    placeholder="e.g. 5.99"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!receipt) return;
                  const name = manualItemName.trim();
                  const price = Number(manualItemPrice);
                  if (!name || !price || price <= 0) {
                    setError('Enter a valid item name and price to add manually.');
                    return;
                  }
                  const newItem: ParsedReceiptItem = {
                    id: `manual-${Date.now()}`,
                    name,
                    quantity: manualItemQuantity,
                    unitPrice: price,
                    totalPrice: price * manualItemQuantity,
                    confidence: 1,
                  };
                  setReceipt({
                    ...receipt,
                    items: [...receipt.items, newItem],
                  });
                  setManualItemName('');
                  setManualItemPrice('');
                  setManualItemQuantity(1);
                  setError(null);
                }}
                className="w-full h-11 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm flex items-center justify-center tap-highlight active:scale-[0.97] transition-transform"
              >
                Add Item
              </button>
            </div>
          </div>

          <button
            onClick={handleSaveToDatabase}
            disabled={saving}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 tap-highlight active:scale-[0.97] transition-transform disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={18} />
            {saving
              ? 'Updating Database...'
              : `Update Database (${receipt.items.length} items · $${itemsTotal.toFixed(2)})`}
          </button>
        </motion.div>
      )}
    </div>
  );
};

export default ScannerView;
