import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReceiptText, TrendingUp } from 'lucide-react';
import { apiService } from '@/lib/api';

interface ReceiptEntry {
  id: string;
  userKey: string;
  storeName: string;
  date: string;
  total: number;
  status: string;
}

interface TrendingItem {
  itemName: string;
  cheapestPrice: number;
  cheapestStore: string;
  storeCount: number;
}

const toTitleCase = (str: string) =>
  str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const SHOPPING_LIST_KEY = 'smartCartShoppingListSession';

function readShoppingList(): { id: string; name: string; sourceItemId?: string; quantity: number; checked: boolean; bestPrice?: number; bestStore?: string }[] {
  try {
    const raw = globalThis.sessionStorage.getItem(SHOPPING_LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeShoppingList(items: ReturnType<typeof readShoppingList>): void {
  globalThis.sessionStorage.setItem(SHOPPING_LIST_KEY, JSON.stringify(items));
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
  const digits = id.replace(/\D/g, '');
  return digits.length >= 6 ? `#${digits.slice(-6)}` : `#${id.slice(-6)}`;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);
  const [trendingItems, setTrendingItems] = useState<TrendingItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(
    () => new Set(readShoppingList().map((i) => i.name.toLowerCase()))
  );

  const toggleShoppingItem = (item: TrendingItem) => {
    const key = item.itemName.toLowerCase();
    const list = readShoppingList();

    if (checkedNames.has(key)) {
      writeShoppingList(list.filter((i) => i.name.toLowerCase() !== key));
      setCheckedNames((prev) => { const next = new Set(prev); next.delete(key); return next; });
    } else {
      writeShoppingList([...list, {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: toTitleCase(item.itemName),
        quantity: 1,
        checked: false,
        bestPrice: item.cheapestPrice,
        bestStore: item.cheapestStore,
      }]);
      setCheckedNames((prev) => new Set(prev).add(key));
    }
  };

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem('smartCartReceiptHistory');
        const all: ReceiptEntry[] = raw ? JSON.parse(raw) : [];
        const userKey = getCurrentUserKey();
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const cutoff = oneMonthAgo.toISOString().slice(0, 10);
        const mine = all
          .filter((r) => r.userKey === userKey && r.date >= cutoff)
          .sort((a, b) => (b.date > a.date ? 1 : -1));
        setReceipts(mine);
      } catch {
        setReceipts([]);
      }
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  useEffect(() => {
    const loadTrending = async () => {
      setTrendingLoading(true);
      try {
        const [pricesResp, storesResp] = await Promise.all([
          apiService.getPrices(),
          apiService.getStores(),
        ]);

        const prices = pricesResp.data || [];
        const stores = storesResp.data || [];
        const storeMap = new Map(stores.map((s) => [s._id || String(s.id), s.name]));

        const items: TrendingItem[] = prices
          .map((p) => {
            const entries = Object.entries(p.prices || {})
              .filter(([, v]) => Number(v) > 0)
              .sort(([, a], [, b]) => Number(a) - Number(b));
            if (!entries.length) return null;
            const [cheapestStoreId, cheapestPrice] = entries[0];
            return {
              itemName: p.itemName || '',
              cheapestPrice: Number(cheapestPrice),
              cheapestStore: storeMap.get(cheapestStoreId) || 'Unknown',
              storeCount: entries.length,
            };
          })
          .filter((x): x is TrendingItem => x !== null && x.itemName.length > 0)
          // Most-tracked first (most stores), then by cheapest price
          .sort((a, b) => b.storeCount - a.storeCount || a.cheapestPrice - b.cheapestPrice)
          .slice(0, 10);

        setTrendingItems(items);
      } catch {
        setTrendingItems([]);
      } finally {
        setTrendingLoading(false);
      }
    };
    void loadTrending();
  }, []);

  return (
    <div className="page-container pt-4 pb-24">
      {/* <h1 className="text-xl font-bold text-foreground mb-1">Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-6">
        <button
          onClick={() => navigate('/scanner')}
          className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          Scan grocery receipts
        </button>{' '}
        to track your spending.
      </p> */}

      {/* Top Tracked Items */}
      <div className="ios-card mb-4">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={16} className="text-primary" />
          <p className="text-sm font-semibold text-foreground">Recommended Items</p>
          {trendingItems.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground"></span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4"></p>

        {trendingLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>
        ) : trendingItems.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2 text-center">
            <TrendingUp size={28} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No price data yet.</p>
            <p className="text-xs text-muted-foreground">
              <button
                onClick={() => navigate('/scanner')}
                className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
              >Scan a receipt</button>{' '}to start tracking prices.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-6 pb-2 pr-2" />
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-3">Item</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 pr-3 whitespace-nowrap">Best Price</th>
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 whitespace-nowrap">Store</th>
                </tr>
              </thead>
              <tbody>
                {trendingItems.map((item) => {
                  const checked = checkedNames.has(item.itemName.toLowerCase());
                  return (
                    <tr
                      key={item.itemName}
                      className="border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleShoppingItem(item)}
                    >
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          readOnly
                          checked={checked}
                          className="w-3.5 h-3.5 accent-primary cursor-pointer"
                        />
                      </td>
                      <td className={`py-2 pr-3 text-xs font-medium max-w-[130px] truncate ${checked ? 'text-primary' : 'text-foreground'}`}>
                        {toTitleCase(item.itemName)}
                      </td>
                      <td className="py-2 pr-3 text-xs font-semibold text-primary text-right whitespace-nowrap">
                        ${item.cheapestPrice.toFixed(2)}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground max-w-[110px] truncate">
                        {toTitleCase(item.cheapestStore)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Scanned Receipts */}
      <div className="ios-card">
        <div className="flex items-center gap-2 mb-1">
          <ReceiptText size={16} className="text-primary" />
          <p className="text-sm font-semibold text-foreground">Scanned Receipts</p>
          {receipts.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">{receipts.length} total</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">Last 30 days</p>

        {receipts.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2 text-center">
            <ReceiptText size={32} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No receipts scanned yet.</p>
            <p className="text-xs text-muted-foreground">
              <button
                onClick={() => navigate('/scanner')}
                className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
              >Go to Scanner</button>{', scan a receipt, and save it.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-3 whitespace-nowrap">ID</th>
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-3 whitespace-nowrap">Date</th>
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2 pr-3">Store</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 whitespace-nowrap">Total ($)</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-muted-foreground">{shortId(r.id)}</span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs whitespace-nowrap">{r.date}</td>
                    <td className="py-2 pr-3 text-foreground font-medium text-xs max-w-[120px] truncate">
                      {r.storeName}
                    </td>
                    <td className="py-2 text-right font-semibold text-xs text-foreground">
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
