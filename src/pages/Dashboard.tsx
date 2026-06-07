import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
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
  preferredPrice: number;
  cheapestPrice: number;
  cheapestStore: string;
  savings: number;
  storeCount: number;
  quantity: number;
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

function getPreferredStoreName(): string {
  try {
    const s = localStorage.getItem('smartCartSession') || localStorage.getItem('smartCartUser');
    if (s) return (JSON.parse(s).preferredStore || '').toLowerCase().trim();
  } catch {}
  return '';
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
        const [pricesResp, storesResp, receiptsResp] = await Promise.all([
          apiService.getPrices(),
          apiService.getStores(),
          apiService.getReceipts(),
        ]);

        const prices = pricesResp.data || [];
        const stores = storesResp.data || [];
        const storeMap = new Map(stores.map((s) => [s._id || String(s.id), s.name]));

        // Find the user's preferred store ID
        const preferredStoreName = getPreferredStoreName();
        const preferredStoreId = preferredStoreName
          ? (stores.find((s) => (s.name || '').toLowerCase().trim() === preferredStoreName)?._id || null)
          : null;

        // Build itemName → quantity from receipt items
        const quantityMap = new Map<string, number>();
        for (const receipt of (receiptsResp.data || [])) {
          for (const item of receipt.items) {
            const key = item.itemName.toLowerCase();
            if (!quantityMap.has(key)) quantityMap.set(key, item.quantity ?? 1);
          }
        }

        // Primary: items where preferred store is pricier than another store (max savings first)
        const items: TrendingItem[] = prices
          .map((p) => {
            const allEntries = Object.entries(p.prices || {})
              .map(([id, v]) => [id, Number(v)] as [string, number])
              .filter(([, v]) => v > 0);
            if (!allEntries.length) return null;

            const quantity = quantityMap.get((p.itemName || '').toLowerCase()) ?? 1;

            if (preferredStoreId) {
              const preferredEntry = allEntries.find(([id]) => id === preferredStoreId);
              if (!preferredEntry) return null;
              const otherEntries = allEntries.filter(([id]) => id !== preferredStoreId);
              if (!otherEntries.length) return null;
              const [cheapestOtherId, cheapestOtherPrice] = otherEntries.reduce(
                (min, e) => (e[1] < min[1] ? e : min)
              );
              const savings = preferredEntry[1] - cheapestOtherPrice;
              if (savings <= 0) return null;
              return {
                itemName: p.itemName || '',
                preferredPrice: preferredEntry[1],
                cheapestPrice: cheapestOtherPrice,
                cheapestStore: storeMap.get(cheapestOtherId) || 'Unknown',
                savings,
                storeCount: allEntries.length,
                quantity,
              };
            }

            // No preferred store — fall back to most-tracked items
            const [cheapestStoreId, cheapestPrice] = allEntries.reduce(
              (min, e) => (e[1] < min[1] ? e : min)
            );
            return {
              itemName: p.itemName || '',
              preferredPrice: 0,
              cheapestPrice,
              cheapestStore: storeMap.get(cheapestStoreId) || 'Unknown',
              savings: 0,
              storeCount: allEntries.length,
              quantity,
            };
          })
          .filter((x): x is TrendingItem => x !== null && x.itemName.length > 0)
          .sort((a, b) => b.savings - a.savings || b.storeCount - a.storeCount)
          .slice(0, 10);

        // Fallback: if no cross-store savings found, show items from user's own receipts
        if (items.length === 0 && receiptsResp.data?.length) {
          const seen = new Set<string>();
          for (const receipt of receiptsResp.data) {
            for (const item of receipt.items) {
              const key = (item.itemName || '').toLowerCase();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              items.push({
                itemName: item.itemName,
                preferredPrice: item.unitPrice,
                cheapestPrice: item.unitPrice,
                cheapestStore: receipt.storeName || '',
                savings: 0,
                storeCount: 1,
                quantity: item.quantity ?? 1,
              });
              if (items.length >= 10) break;
            }
            if (items.length >= 10) break;
          }
        }

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
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2">Item</th>
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
                      <td className={`py-2 text-xs font-medium max-w-[160px] truncate ${checked ? 'text-primary' : 'text-foreground'}`}>
                        {toTitleCase(item.itemName)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {checkedNames.size > 0 && (
          <button
            onClick={() => navigate('/compare')}
            className="mt-4 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm active:scale-[0.97] transition-transform"
          >
            Compare Price
          </button>
        )}
      </div>

      {/* Scanned Receipts */}
      {/* <div className="ios-card">
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
      </div> */}
    </div>
  );
};

export default Dashboard;
