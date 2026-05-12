import { useState, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category =
  | "produce"
  | "dairy"
  | "meat"
  | "bakery"
  | "beverages"
  | "snacks"
  | "frozen"
  | "household"
  | "personal_care"
  | "other";

interface ReceiptItem {
  name: string;
  quantity: number | null;
  unit_price: number | null;
  total_price: number;
  category: Category;
}

interface ReceiptData {
  store_name: string | null;
  store_address: string | null;
  date: string | null;
  time: string | null;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number;
  payment_method: string | null;
  cashier: string | null;
  transaction_id: string | null;
}

interface ImageState {
  file: File;
  dataUrl: string;
  base64: string;
  mimeType: string;
}

type Status = "idle" | "analyzing" | "done" | "error";

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #0f0e0d;
    --paper: #f5f0e8;
    --tape: #e8e0cc;
    --accent: #d4550a;
    --accent2: #1a6b3c;
    --muted: #8a8070;
    --border: #c8bfaa;
    --white: #fefcf8;
  }

  body { background: var(--paper); font-family: 'Syne', sans-serif; }

  .scanner-app {
    min-height: 100vh;
    background: var(--paper);
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
  }

  .header { text-align: center; position: relative; }

  .header-eyebrow {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 8px;
  }

  .header h1 {
    font-size: clamp(28px, 5vw, 42px);
    font-weight: 800;
    color: var(--ink);
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .header h1 span { color: var(--accent); }

  .main-card {
    width: 100%;
    max-width: 860px;
    background: var(--white);
    border: 1.5px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 4px 4px 0 var(--border);
  }

  /* Upload Zone */
  .upload-zone {
    padding: 48px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    cursor: pointer;
    border-bottom: 1.5px solid var(--border);
    transition: background 0.15s;
    position: relative;
    overflow: hidden;
  }

  .upload-zone:hover { background: var(--tape); }
  .upload-zone.drag-over { background: #fde8da; border-color: var(--accent); }

  .upload-zone::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: repeating-linear-gradient(90deg, var(--accent) 0, var(--accent) 8px, transparent 8px, transparent 16px);
  }

  .upload-icon {
    width: 64px; height: 64px;
    border: 2px dashed var(--border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: var(--muted);
    transition: all 0.15s;
  }

  .upload-zone:hover .upload-icon,
  .upload-zone.drag-over .upload-icon {
    border-color: var(--accent);
    color: var(--accent);
    transform: scale(1.1);
  }

  .upload-label { font-size: 15px; font-weight: 600; color: var(--ink); }

  .upload-sub {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.05em;
  }

  .upload-btn {
    background: var(--ink);
    color: var(--white);
    border: none;
    padding: 10px 24px;
    font-family: 'Syne', sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 2px;
    transition: background 0.15s;
  }

  .upload-btn:hover { background: var(--accent); }

  /* Preview Panel */
  .preview-panel {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1.5px solid var(--border);
  }

  @media (max-width: 640px) {
    .preview-panel { grid-template-columns: 1fr; }
  }

  .preview-image-wrap {
    position: relative;
    background: var(--tape);
    border-right: 1.5px solid var(--border);
    min-height: 260px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .preview-image-wrap img {
    max-width: 100%;
    max-height: 320px;
    object-fit: contain;
    border: 1px solid var(--border);
    box-shadow: 2px 2px 0 var(--border);
  }

  .preview-reset {
    position: absolute;
    top: 10px; right: 10px;
    background: var(--ink);
    color: var(--white);
    border: none;
    width: 28px; height: 28px;
    border-radius: 50%;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: monospace;
  }

  .analyze-panel {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    justify-content: center;
    align-items: flex-start;
  }

  .analyze-panel h3 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    font-family: 'DM Mono', monospace;
  }

  .filename-tag {
    background: var(--tape);
    border: 1px solid var(--border);
    padding: 6px 12px;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    color: var(--ink);
    border-radius: 2px;
    word-break: break-all;
  }

  .analyze-btn {
    background: var(--accent);
    color: var(--white);
    border: none;
    padding: 14px 28px;
    font-family: 'Syne', sans-serif;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    justify-content: center;
    box-shadow: 2px 2px 0 #a03a05;
  }

  .analyze-btn:hover:not(:disabled) {
    background: #bb4708;
    transform: translate(1px, 1px);
    box-shadow: 1px 1px 0 #a03a05;
  }

  .analyze-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Results */
  .results-section { padding: 24px 32px; }

  .results-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1.5px solid var(--border);
  }

  .results-title { font-size: 18px; font-weight: 800; color: var(--ink); letter-spacing: -0.01em; }

  .store-badge {
    background: var(--accent2);
    color: white;
    padding: 4px 12px;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    border-radius: 2px;
    text-transform: uppercase;
  }

  .receipt-meta { display: flex; gap: 24px; margin-bottom: 20px; flex-wrap: wrap; }

  .meta-item { display: flex; flex-direction: column; gap: 2px; }

  .meta-label {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .meta-value { font-size: 14px; font-weight: 600; color: var(--ink); }

  /* Items Table */
  .items-table {
    width: 100%;
    border-collapse: collapse;
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .items-table thead tr { border-bottom: 2px solid var(--ink); }

  .items-table th {
    text-align: left;
    padding: 8px 12px;
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 500;
  }

  .items-table th:last-child { text-align: right; }

  .items-table td {
    padding: 9px 12px;
    border-bottom: 1px solid var(--tape);
    color: var(--ink);
  }

  .items-table td:last-child { text-align: right; font-weight: 500; }
  .items-table tbody tr:hover { background: var(--tape); }

  .category-pill {
    display: inline-block;
    background: var(--tape);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 1px 6px;
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Totals */
  .totals-block {
    background: var(--tape);
    border: 1.5px solid var(--border);
    border-radius: 2px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: 'DM Mono', monospace;
    font-size: 13px;
  }

  .totals-row { display: flex; justify-content: space-between; color: var(--muted); }

  .totals-row.grand {
    border-top: 1.5px solid var(--border);
    padding-top: 10px;
    margin-top: 4px;
    color: var(--ink);
    font-size: 16px;
    font-weight: 700;
  }

  /* Error */
  .error-box {
    background: #fde8da;
    border: 1.5px solid var(--accent);
    border-radius: 2px;
    padding: 14px 20px;
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    color: var(--accent);
    margin: 16px 32px;
  }

  /* Scan again */
  .scan-again-bar {
    padding: 16px 32px;
    border-top: 1.5px solid var(--border);
    background: var(--tape);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .scan-again-text { font-family: 'DM Mono', monospace; font-size: 12px; color: var(--muted); }

  .scan-again-btn {
    background: transparent;
    color: var(--ink);
    border: 1.5px solid var(--ink);
    padding: 8px 20px;
    font-family: 'Syne', sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.15s;
  }

  .scan-again-btn:hover { background: var(--ink); color: var(--white); }

  /* Loading */
  .analyzing-overlay {
    padding: 48px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    border-bottom: 1.5px solid var(--border);
  }

  .analyzing-ticker {
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    color: var(--accent);
    letter-spacing: 0.1em;
    animation: blink 1s step-end infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }

  .analyzing-bar {
    width: 280px; height: 4px;
    background: var(--tape);
    border-radius: 2px;
    overflow: hidden;
  }

  .analyzing-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    animation: fillBar 2s ease-in-out infinite;
  }
  @keyframes fillBar { 0% { width: 0%; } 70% { width: 90%; } 100% { width: 90%; } }
`;

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a grocery receipt OCR and data extraction expert. The user will send you an image of a grocery receipt.
Extract ALL information and return ONLY valid JSON (no markdown, no explanation) in this exact structure:

{
  "store_name": "string",
  "store_address": "string or null",
  "date": "string or null",
  "time": "string or null",
  "items": [
    {
      "name": "string",
      "quantity": number or null,
      "unit_price": number or null,
      "total_price": number,
      "category": "produce|dairy|meat|bakery|beverages|snacks|frozen|household|personal_care|other"
    }
  ],
  "subtotal": number or null,
  "tax": number or null,
  "discount": number or null,
  "total": number,
  "payment_method": "string or null",
  "cashier": "string or null",
  "transaction_id": "string or null"
}

Rules:
- All prices as floats with 2 decimal places
- If a value is not visible, use null
- item.total_price is mandatory; estimate from qty * unit_price if needed
- Return ONLY the JSON object, nothing else`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReceiptScanner(): JSX.Element {
  const [image, setImage] = useState<ImageState | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFile = (file: File | undefined): void => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      setImage({ file, dataUrl, base64, mimeType: file.type });
      setStatus("idle");
      setResult(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    loadFile(e.target.files?.[0]);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    loadFile(e.dataTransfer.files[0]);
  };

  const analyze = useCallback(async (): Promise<void> => {
    if (!image) return;
    setStatus("analyzing");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: image.mimeType,
                    data: image.base64,
                  },
                },
                {
                  type: "text",
                  text: "Extract all data from this grocery receipt and return as JSON.",
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = await response.json();
      const text: string =
        data.content?.map((b: { text?: string }) => b.text ?? "").join("") ?? "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed: ReceiptData = JSON.parse(clean);
      setResult(parsed);
      setStatus("done");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to analyze receipt.";
      setError(message);
      setStatus("error");
    }
  }, [image]);

  const reset = (): void => {
    setImage(null);
    setStatus("idle");
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const fmt = (n: number | null | undefined): string =>
    n != null ? `$${Number(n).toFixed(2)}` : "—";

  return (
    <>
      <style>{styles}</style>
      <div className="scanner-app">
        <div className="header">
          <div className="header-eyebrow">AI-Powered OCR</div>
          <h1>
            Receipt <span>Scanner</span>
          </h1>
        </div>

        <div className="main-card">
          {/* Hidden file input — always in DOM so ref is never null */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={onFileInput}
          />

          {/* Upload zone */}
          {!image && (
            <div
              className={`upload-zone${dragOver ? " drag-over" : ""}`}
              onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-icon">📄</div>
              <div className="upload-label">Drop your receipt image here</div>
              <div className="upload-sub">JPG · PNG · WEBP · GIF</div>
              <button
                type="button"
                className="upload-btn"
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Choose File
              </button>
            </div>
          )}

          {/* Preview + Analyze panel */}
          {image && status !== "analyzing" && (
            <div className="preview-panel">
              <div className="preview-image-wrap">
                <img src={image.dataUrl} alt="Receipt preview" />
                <button
                  type="button"
                  className="preview-reset"
                  onClick={reset}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
              <div className="analyze-panel">
                <h3>Ready to scan</h3>
                <div className="filename-tag">{image.file.name}</div>
                <p
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 12,
                    color: "var(--muted)",
                    lineHeight: 1.6,
                  }}
                >
                  Claude will extract items, prices, store info, totals, and more
                  from your receipt.
                </p>
                <button
                  type="button"
                  className="analyze-btn"
                  onClick={analyze}
                  disabled={status === "analyzing"}
                >
                  ⚡ Analyze Receipt
                </button>
              </div>
            </div>
          )}

          {/* Analyzing state */}
          {status === "analyzing" && (
            <div className="analyzing-overlay">
              <div style={{ fontSize: 32 }}>🔍</div>
              <div className="analyzing-ticker">Reading receipt…</div>
              <div className="analyzing-bar">
                <div className="analyzing-fill" />
              </div>
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                Extracting items · prices · totals
              </div>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="error-box">⚠ {error}</div>
          )}

          {/* Results */}
          {status === "done" && result && (
            <div className="results-section">
              <div className="results-header">
                <div className="results-title">
                  {result.store_name ?? "Receipt Data"}
                </div>
                {(result.items?.length ?? 0) > 0 && (
                  <div className="store-badge">{result.items.length} items</div>
                )}
              </div>

              <div className="receipt-meta">
                {result.date && (
                  <div className="meta-item">
                    <span className="meta-label">Date</span>
                    <span className="meta-value">{result.date}</span>
                  </div>
                )}
                {result.time && (
                  <div className="meta-item">
                    <span className="meta-label">Time</span>
                    <span className="meta-value">{result.time}</span>
                  </div>
                )}
                {result.store_address && (
                  <div className="meta-item">
                    <span className="meta-label">Address</span>
                    <span className="meta-value">{result.store_address}</span>
                  </div>
                )}
                {result.payment_method && (
                  <div className="meta-item">
                    <span className="meta-label">Payment</span>
                    <span className="meta-value">{result.payment_method}</span>
                  </div>
                )}
                {result.transaction_id && (
                  <div className="meta-item">
                    <span className="meta-label">TXN ID</span>
                    <span className="meta-value">{result.transaction_id}</span>
                  </div>
                )}
              </div>

              {result.items?.length > 0 && (
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Category</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item: ReceiptItem, i: number) => (
                      <tr key={i}>
                        <td>{item.name}</td>
                        <td>
                          <span className="category-pill">
                            {item.category ?? "other"}
                          </span>
                        </td>
                        <td>{item.quantity ?? "—"}</td>
                        <td>{item.unit_price != null ? fmt(item.unit_price) : "—"}</td>
                        <td>{fmt(item.total_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="totals-block">
                {result.subtotal != null && (
                  <div className="totals-row">
                    <span>Subtotal</span>
                    <span>{fmt(result.subtotal)}</span>
                  </div>
                )}
                {result.discount != null && (
                  <div className="totals-row">
                    <span>Discount</span>
                    <span>−{fmt(result.discount)}</span>
                  </div>
                )}
                {result.tax != null && (
                  <div className="totals-row">
                    <span>Tax</span>
                    <span>{fmt(result.tax)}</span>
                  </div>
                )}
                <div className="totals-row grand">
                  <span>Total</span>
                  <span>{fmt(result.total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Scan again bar */}
          {(status === "done" || status === "error") && (
            <div className="scan-again-bar">
              <span className="scan-again-text">Scan another receipt?</span>
              <button type="button" className="scan-again-btn" onClick={reset}>
                ↩ Start Over
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
