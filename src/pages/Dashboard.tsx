import { useEffect, useState } from 'react';
import { ReceiptText } from 'lucide-react';

interface ReceiptEntry {
  id: string;
  userKey: string;
  storeName: string;
  date: string;
  total: number;
  status: string;
}

function getCurrentUserKey(): string {
  try {
    const s = localStorage.getItem('smartCartSession') || localStorage.getItem('smartCartUser');
    if (s) {
      const p = JSON.parse(s);
      return p.phoneNumber || p.id || p.email || 'unknown';
    }
  } catch {}
  return 'unknown';
}

function shortId(id: string): string {
  // Extract numeric timestamp from "receipt-1234567890123" and show last 6 digits
  const digits = id.replace(/\D/g, '');
  return digits.length >= 6 ? `#${digits.slice(-6)}` : `#${id.slice(-6)}`;
}

const Dashboard = () => {
  const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem('smartCartReceiptHistory');
        const all: ReceiptEntry[] = raw ? JSON.parse(raw) : [];
        const userKey = getCurrentUserKey();
        const mine = all
          .filter((r) => r.userKey === userKey)
          .sort((a, b) => (b.date > a.date ? 1 : -1)); // newest first
        setReceipts(mine);
      } catch {
        setReceipts([]);
      }
    };

    load();
    // Refresh when the tab regains focus (user comes back from scanner)
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  return (
    <div className="page-container pt-4 pb-24">
      <h1 className="text-xl font-bold text-foreground mb-1">Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Scan grocery receipts to track your spending.
      </p>

      <div className="ios-card">
        <div className="flex items-center gap-2 mb-4">
          <ReceiptText size={16} className="text-primary" />
          <p className="text-sm font-semibold text-foreground">Scanned Receipts</p>
          {receipts.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">{receipts.length} total</span>
          )}
        </div>

        {receipts.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2 text-center">
            <ReceiptText size={32} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No receipts scanned yet.</p>
            <p className="text-xs text-muted-foreground">
              Go to Scanner, scan a receipt, and save it.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-3 whitespace-nowrap">
                    Scan ID
                  </th>
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-3">
                    Store
                  </th>
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-3 whitespace-nowrap">
                    Date
                  </th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 whitespace-nowrap">
                    Total ($)
                  </th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {shortId(r.id)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-foreground font-medium max-w-[120px] truncate">
                      {r.storeName}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs whitespace-nowrap">
                      {r.date}
                    </td>
                    <td className="py-2 text-right font-semibold text-foreground">
                      {r.total > 0 ? `$${r.total.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
