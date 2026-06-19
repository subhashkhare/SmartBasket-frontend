import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { apiService } from '@/lib/api';
import { inferCityStateFromZip } from '@/lib/ocr';
import { getLocalLastScan, getPreferredStoreName, getZipCode } from '@/lib/utils';

interface TrendingItem {
  itemName: string;
  itemId?: string;
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

const Dashboard = () => {
  const navigate = useNavigate();
  const [trendingItems, setTrendingItems] = useState<TrendingItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(
    () => new Set(readShoppingList().map((i) => i.name.toLowerCase()))
  );

  const scanReminder = useMemo(() => {
    try {
      const s = localStorage.getItem('smartCartSession') || localStorage.getItem('smartCartUser');
      const phone = s ? (JSON.parse(s).phoneNumber || '') : '';
      const local = getLocalLastScan(phone);
      if (!local || local.days > 15) return null;
      const deadline = new Date(new Date(local.timestamp).getTime() + 15 * 86_400_000);
      return deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return null; }
  }, []);

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
        sourceItemId: item.itemId,
        quantity: 1,
        checked: false,
        bestPrice: item.cheapestPrice,
        bestStore: item.cheapestStore,
      }]);
      setCheckedNames((prev) => new Set(prev).add(key));
    }
  };

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

        // Resolve user's state from their zip code (cached per zip in sessionStorage)
        const userZip = getZipCode() || '';
        let userState = '';
        if (userZip) {
          try {
            const cacheKey = `smartCartStateForZip_${userZip}`;
            const cached = sessionStorage.getItem(cacheKey);
            if (cached !== null) {
              userState = cached;
            } else {
              const loc = await inferCityStateFromZip(userZip);
              userState = loc?.state || '';
              sessionStorage.setItem(cacheKey, userState);
            }
          } catch { /* ignore */ }
        }
        // stateFilterActive = true means we know the user's state and must restrict to it.
        // When false (zip lookup failed / no zip), fall through to show all stores.
        const stateFilterActive = userState !== '';
        const stateStoreIds = stateFilterActive
          ? new Set(stores.filter((s) => s.state === userState).map((s) => s._id || String(s.id || '')))
          : new Set<string>();

        // State is known but no stores in DB carry that state tag → nothing to show.
        if (stateFilterActive && stateStoreIds.size === 0) {
          setTrendingItems([]);
          return;
        }

        // Find the user's preferred store ID
        const preferredStoreName = getPreferredStoreName().toLowerCase();
        const preferredStoreId = preferredStoreName
          ? (stores.find((s) => (s.name || '').toLowerCase().trim() === preferredStoreName)?._id || null)
          : null;

        let items: TrendingItem[] = [];

        if (preferredStoreId) {
          // Items that MUST be available at the preferred store, sorted by max price
          // difference (preferred store price − cheapest other store price).
          items = prices
            .map((p): TrendingItem | null => {
              const allEntries = Object.entries(p.prices || {})
                .map(([id, v]) => [id, Number(v)] as [string, number])
                .filter(([, v]) => v > 0);
              if (!allEntries.length) return null;

              const preferredEntry = allEntries.find(([id]) => id === preferredStoreId);
              if (!preferredEntry) return null; // must be at preferred store

              const otherEntries = allEntries.filter(([id]) => {
                if (id === preferredStoreId) return false;
                return stateStoreIds.size === 0 || stateStoreIds.has(id);
              });

              let cheapestOtherId = '';
              let cheapestOtherPrice = preferredEntry[1];
              if (otherEntries.length > 0) {
                [cheapestOtherId, cheapestOtherPrice] = otherEntries.reduce(
                  (min, e) => (e[1] < min[1] ? e : min)
                );
              }
              const savings = preferredEntry[1] - cheapestOtherPrice;

              return {
                itemName: p.itemName || '',
                itemId: p.itemId || p._id,
                preferredPrice: preferredEntry[1],
                cheapestPrice: cheapestOtherPrice,
                cheapestStore: p.storeNames?.[cheapestOtherId] || storeMap.get(cheapestOtherId) || '',
                savings,
                storeCount: allEntries.length,
                quantity: 1,
              };
            })
            .filter((x): x is TrendingItem => x !== null && x.itemName.length > 0)
            .sort((a, b) => b.savings - a.savings)
            .slice(0, 5);
        } else if (preferredStoreName) {
          // Preferred store name doesn't match any store in the database — fall back to
          // historical median price vs. the cheapest current price across all stores.
          // Medians are now per (itemId, state); pick the entry with the most history
          // (richest data) for each item, favouring state-specific records over the
          // state='' backfill bucket when both exist.
          const mediansResp = await apiService.getPriceMedians();
          const medianMap = new Map<string, number>();
          for (const m of (mediansResp.data || [])) {
            const existing = medianMap.get(m.itemId);
            if (existing === undefined || (m.state && m.state !== '')) {
              medianMap.set(m.itemId, m.medianPrice);
            }
          }

          items = prices
            .map((p): TrendingItem | null => {
              const itemId = p.itemId || p._id;
              const median = itemId ? medianMap.get(itemId) : undefined;
              if (median === undefined) return null;

              const allEntries = Object.entries(p.prices || {})
                .map(([id, v]) => [id, Number(v)] as [string, number])
                .filter(([, v]) => v > 0);
              if (!allEntries.length) return null;

              const effectiveEntries = stateStoreIds.size > 0
                ? allEntries.filter(([id]) => stateStoreIds.has(id))
                : allEntries;
              if (!effectiveEntries.length) return null;

              const [minId, minPrice] = effectiveEntries.reduce((min, e) => (e[1] < min[1] ? e : min));
              const diff = median - minPrice;

              return {
                itemName: p.itemName || '',
                itemId,
                preferredPrice: median,
                cheapestPrice: minPrice,
                cheapestStore: p.storeNames?.[minId] || storeMap.get(minId) || '',
                savings: diff,
                storeCount: effectiveEntries.length,
                quantity: 1,
              };
            })
            .filter((x): x is TrendingItem => x !== null && x.itemName.length > 0)
            .sort((a, b) => b.savings - a.savings)
            .slice(0, 5);
        } else {
          // No preferred store set at all: top 5 by max price spread across catalog
          items = prices
            .map((p) => {
              const allEntries = Object.entries(p.prices || {})
                .map(([id, v]) => [id, Number(v)] as [string, number])
                .filter(([, v]) => v > 0);
              const effectiveEntries = stateStoreIds.size > 0
                ? allEntries.filter(([id]) => stateStoreIds.has(id))
                : allEntries;
              if (effectiveEntries.length < 2) return null;
              const maxPrice = Math.max(...effectiveEntries.map(([, v]) => v));
              const [cheapestId, minPrice] = effectiveEntries.reduce((min, e) => e[1] < min[1] ? e : min);
              const spread = maxPrice - minPrice;
              if (spread <= 0) return null;
              return {
                itemName: p.itemName || '',
                preferredPrice: maxPrice,
                cheapestPrice: minPrice,
                cheapestStore: p.storeNames?.[cheapestId] || storeMap.get(cheapestId) || '',
                savings: spread,
                storeCount: effectiveEntries.length,
                quantity: 1,
              };
            })
            .filter((x): x is TrendingItem => x !== null && x.itemName.length > 0)
            .sort((a, b) => b.savings - a.savings)
            .slice(0, 5);
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

      {scanReminder && (
        <div className="ios-card mb-4 border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            Scan a new receipt by{' '}
            <span className="font-semibold">{scanReminder}</span>{' '}
            to keep your price data fresh.
          </p>
        </div>
      )}

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
            onClick={() => {
              // Replace session storage with exactly the currently-checked recommended items
              const selected = trendingItems
                .filter((item) => checkedNames.has(item.itemName.toLowerCase()))
                .map((item, idx) => ({
                  id: `item-${Date.now()}-${idx}`,
                  name: toTitleCase(item.itemName),
                  sourceItemId: item.itemId,
                  quantity: 1,
                  checked: false,
                  bestPrice: item.cheapestPrice,
                  bestStore: item.cheapestStore,
                }));
              writeShoppingList(selected);
              navigate('/compare');
            }}
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
