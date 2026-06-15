import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/lib/api';
import { PriceObservation, ShoppingListItem, Store } from '@/types';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getPreferredStoreName } from '@/lib/utils';

type StoreComparison = { store: Store; totalCost: number; coveredItemCount: number; isComplete: boolean };
type UnifiedRow = {
  itemName: string;
  preferredPrice: string;
  oneStorePrice: string;
  multiShopPrice: string;
  multiShopStore: string;
};

const SHOPPING_LIST_SESSION_KEY = 'smartCartShoppingListSession';

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForMatch(value: string): string[] {
  return normalizeForMatch(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function matchPriceForShoppingItem(item: ShoppingListItem, prices: PriceObservation[]): PriceObservation | undefined {
  const sourceItemId = item.sourceItemId?.trim();
  if (sourceItemId) {
    const bySource = prices.find((price) => {
      const candidateItemIds = [price.itemId, price._id].filter((value): value is string => Boolean(value));
      return candidateItemIds.includes(sourceItemId);
    });
    if (bySource) return bySource;
  }

  const queryName = normalizeForMatch(item.name);
  if (!queryName) return undefined;

  const exact = prices.find((price) => normalizeForMatch(price.itemName) === queryName);
  if (exact) return exact;

  const contains = prices.find((price) => {
    const candidate = normalizeForMatch(price.itemName);
    return candidate.includes(queryName) || queryName.includes(candidate);
  });
  if (contains) return contains;

  const queryTokens = tokenizeForMatch(item.name);
  if (!queryTokens.length) return undefined;

  let bestMatch: PriceObservation | undefined;
  let bestScore = 0;

  prices.forEach((price) => {
    const candidateTokens = tokenizeForMatch(price.itemName);
    if (!candidateTokens.length) return;

    const overlapCount = queryTokens.filter((token) => candidateTokens.includes(token)).length;
    if (overlapCount === 0) return;

    const overlapRatio = overlapCount / queryTokens.length;
    if (overlapRatio > bestScore) {
      bestScore = overlapRatio;
      bestMatch = price;
    }
  });

  return bestScore >= 0.5 ? bestMatch : undefined;
}

const ComparisonScreen = () => {
  const [warning, setWarning] = useState<string | null>(null);

  const { data: storesResp, isLoading: storesLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: () => apiService.getStores(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: pricesResp, isLoading: pricesLoading } = useQuery({
    queryKey: ['prices'],
    queryFn: () => apiService.getPrices(),
    staleTime: 5 * 60 * 1000,
  });

  const loading = storesLoading || pricesLoading;

  const stores: Store[] = useMemo(() => (!storesResp?.error && storesResp?.data) ? storesResp.data : [], [storesResp]);
  const prices: PriceObservation[] = useMemo(() => (!pricesResp?.error && pricesResp?.data) ? pricesResp.data : [], [pricesResp]);

  useEffect(() => {
    if (loading) return;
    const errors: string[] = [];
    if (storesResp?.error) errors.push(storesResp.error);
    if (pricesResp?.error) errors.push(pricesResp.error);
    if (errors.length > 0) {
      setWarning('Live comparison data is currently unavailable. ' + errors.join(' '));
    } else {
      setWarning(null);
    }
  }, [loading, storesResp?.error, pricesResp?.error]);


  const storeById = useMemo(() => {
    const m = new Map<string, Store>();
    stores.forEach((s) => m.set(s._id || String(s.id), s));
    return m;
  }, [stores]);

  // Fallback: price catalog storeIds may be store names instead of MongoDB _id
  const storeByName = useMemo(() => {
    const m = new Map<string, Store>();
    stores.forEach((s) => { if (s.name) m.set(s.name.toLowerCase(), s); });
    return m;
  }, [stores]);

  const resolveStore = useCallback((id: string): Store | undefined =>
    storeById.get(id) ?? storeByName.get(id.toLowerCase()),
  [storeById, storeByName]);

  const shoppingListItems = useMemo(() => getSessionShoppingListItems(), []);

  const comparisonRows = useMemo(() => {
    return shoppingListItems.map((item) => ({
      item,
      matchedPrice: matchPriceForShoppingItem(item, prices),
    }));
  }, [prices, shoppingListItems]);

  const filteredPrices = useMemo(() => {
    const seen = new Set<string>();
    const matched: PriceObservation[] = [];

    comparisonRows.forEach(({ matchedPrice }) => {
      if (!matchedPrice) return;
      const key = matchedPrice._id || matchedPrice.itemId || matchedPrice.itemName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      matched.push(matchedPrice);
    });

    return matched;
  }, [comparisonRows]);

  const comparisons: StoreComparison[] = useMemo(() => {
    // Always use all stores — location filter is unreliable when store coords default to SF fallback
    const candidateStores = stores;

    if (!candidateStores.length) return [];
    const totals = new Map<string, number>();
    const coverage = new Map<string, number>();
    candidateStores.forEach((s) => {
      const storeId = s._id || String(s.id);
      totals.set(storeId, 0);
      coverage.set(storeId, 0);
    });

    for (const row of filteredPrices) {
      for (const [storeId, value] of Object.entries(row.prices || {})) {
        if (!totals.has(storeId)) continue;
        totals.set(storeId, (totals.get(storeId) || 0) + Number(value || 0));
        coverage.set(storeId, (coverage.get(storeId) || 0) + 1);
      }
    }

    return candidateStores
      .map((store) => ({
        store,
        totalCost: Number((totals.get(store._id || String(store.id)) || 0).toFixed(2)),
        coveredItemCount: coverage.get(store._id || String(store.id)) || 0,
        isComplete: (coverage.get(store._id || String(store.id)) || 0) === filteredPrices.length,
      }))
      .filter((r) => r.coveredItemCount > 0)
      .sort((a, b) => {
        if (a.isComplete !== b.isComplete) {
          return a.isComplete ? -1 : 1;
        }
        if (a.coveredItemCount !== b.coveredItemCount) {
          return b.coveredItemCount - a.coveredItemCount;
        }
        return a.totalCost - b.totalCost;
      });
  }, [filteredPrices, stores]);

  const sorted = comparisons;
  const cheapest = sorted[0];


  const preferredStoreName = useMemo(() => getPreferredStoreName() || cheapest?.store.name || '', [cheapest?.store.name]);

  const preferredStore = useMemo(() => {
    if (!preferredStoreName) return cheapest?.store;
    // Exact match
    const exact = stores.find((s) => s.name === preferredStoreName);
    if (exact) return exact;
    // Case-insensitive match
    const lower = preferredStoreName.toLowerCase();
    const caseMatch = stores.find((s) => s.name.toLowerCase() === lower);
    if (caseMatch) return caseMatch;
    // Partial match: preferred name contains DB name or vice versa
    const partial = stores.find((s) => {
      const sLower = s.name.toLowerCase();
      return lower.includes(sLower) || sLower.includes(lower);
    });
    if (partial) return partial;
    // No match in DB — fall back to cheapest store
    return cheapest?.store;
  }, [preferredStoreName, stores, cheapest]);

  const preferredStoreId = preferredStore?._id || String(preferredStore?.id || '');
  const bestSingleStore = useMemo(() => {
    const completeStores = sorted.filter((entry) => entry.isComplete);
    const nonPreferredCompleteStores = preferredStoreId
      ? completeStores.filter((entry) => (entry.store._id || String(entry.store.id)) !== preferredStoreId)
      : completeStores;

    if (nonPreferredCompleteStores.length > 0) {
      return nonPreferredCompleteStores[0];
    }

    if (completeStores.length > 0) {
      return completeStores[0];
    }

    const nonPreferredCandidates = preferredStoreId
      ? sorted.filter((entry) => (entry.store._id || String(entry.store.id)) !== preferredStoreId)
      : sorted;

    if (nonPreferredCandidates.length > 0) {
      return nonPreferredCandidates[0];
    }

    return sorted[0];
  }, [preferredStoreId, sorted]);
  const bestSingleStoreId = bestSingleStore?.store._id || String(bestSingleStore?.store.id || '');

  // Fallback: when comparisons is empty (e.g. price store IDs don't match current stores),
  // derive the best single-store ID directly from filteredPrices coverage + cost.
  const fallbackBestStoreId = useMemo(() => {
    if (sorted.length > 0) return null;
    const totals = new Map<string, { cost: number; count: number }>();
    for (const price of filteredPrices) {
      for (const [id, val] of Object.entries(price.prices || {})) {
        if (!Number(val)) continue;
        const prev = totals.get(id) ?? { cost: 0, count: 0 };
        totals.set(id, { cost: prev.cost + Number(val), count: prev.count + 1 });
      }
    }
    let bestId: string | null = null;
    let bestCount = 0;
    let bestCost = Infinity;
    for (const [id, { cost, count }] of totals) {
      if (count > bestCount || (count === bestCount && cost < bestCost)) {
        bestId = id;
        bestCount = count;
        bestCost = cost;
      }
    }
    return bestId;
  }, [filteredPrices, sorted]);

  const effectiveBestStoreId = bestSingleStoreId || fallbackBestStoreId || '';

  const preferredStoreName_col = preferredStore?.name || 'Preferred Store';

  // Find the name for the "best single store" column from storeNames embedded in price docs
  const oneStoreName_col = useMemo(() => {
    if (bestSingleStore?.store.name) return bestSingleStore.store.name;
    if (!effectiveBestStoreId) return 'Best Store';
    const fromStoreNames = filteredPrices
      .map((p) => p.storeNames?.[effectiveBestStoreId])
      .find(Boolean);
    return fromStoreNames || resolveStore(effectiveBestStoreId)?.name || 'Best Store';
  }, [bestSingleStore, effectiveBestStoreId, filteredPrices, resolveStore]);

  const unifiedRows: UnifiedRow[] = useMemo(() => {
    return comparisonRows.map(({ item, matchedPrice }) => {
      if (!matchedPrice) {
        return { itemName: item.name, preferredPrice: '—', oneStorePrice: '—', multiShopPrice: '—', multiShopStore: '—' };
      }

      const preferredStorePrice = matchedPrice.prices?.[preferredStoreId];
      const oneStorePrice = matchedPrice.prices?.[effectiveBestStoreId];

      // Multi Shop: cheapest store where we can identify the name; fall back to absolute cheapest
      const entries = Object.entries(matchedPrice.prices || {})
        .filter(([, v]) => Number(v) > 0)
        .sort(([, a], [, b]) => Number(a) - Number(b));
      const cheapestNamed = entries.find(([id]) =>
        !!(matchedPrice.storeNames?.[id] || resolveStore(id)?.name)
      );
      const [cheapestStoreId, cheapestPrice] = (cheapestNamed ?? entries[0] ?? [null, null]) as [string | null, number | null];

      return {
        itemName: item.name,
        preferredPrice: preferredStorePrice != null ? `$${Number(preferredStorePrice).toFixed(2)}` : '—',
        oneStorePrice:  oneStorePrice       != null ? `$${Number(oneStorePrice).toFixed(2)}`       : '—',
        multiShopPrice: cheapestPrice       != null ? `$${Number(cheapestPrice).toFixed(2)}`       : '—',
        multiShopStore: cheapestStoreId
          ? (matchedPrice.storeNames?.[cheapestStoreId] || resolveStore(cheapestStoreId)?.name || '')
          : '—',
      };
    });
  }, [comparisonRows, preferredStoreId, effectiveBestStoreId, resolveStore]);

  const basketTotals = useMemo(() => {
    let preferred = 0, oneStore = 0, multiShop = 0;
    for (const row of unifiedRows) {
      if (row.preferredPrice !== '—') preferred += Number(row.preferredPrice.replace('$', ''));
      if (row.oneStorePrice  !== '—') oneStore  += Number(row.oneStorePrice.replace('$', ''));
      if (row.multiShopPrice !== '—') multiShop += Number(row.multiShopPrice.replace('$', ''));
    }
    return {
      preferred: preferred > 0 ? `$${preferred.toFixed(2)}` : '—',
      oneStore:  oneStore  > 0 ? `$${oneStore.toFixed(2)}`  : '—',
      multiShop: multiShop > 0 ? `$${multiShop.toFixed(2)}` : '—',
    };
  }, [unifiedRows]);

  const savingsSummary = useMemo(() => {
    const parse = (s: string) => (s !== '—' ? Number(s.replace('$', '')) : null);
    const prefTotal = parse(basketTotals.preferred);
    const oneTotal  = parse(basketTotals.oneStore);
    const multiTotal = parse(basketTotals.multiShop);

    const rows = [
      { label: preferredStoreName_col, total: prefTotal,  savingsVsPref: null as number | null, isBaseline: true },
      { label: oneStoreName_col,        total: oneTotal,   savingsVsPref: prefTotal != null && oneTotal  != null ? prefTotal - oneTotal  : null, isBaseline: false },
      { label: 'Multi Shop',            total: multiTotal, savingsVsPref: prefTotal != null && multiTotal != null ? prefTotal - multiTotal : null, isBaseline: false },
    ];

    let bestIdx = 0;
    let bestTotal = rows[0].total ?? Infinity;
    rows.forEach((r, i) => {
      if (r.total != null && r.total < bestTotal) { bestTotal = r.total; bestIdx = i; }
    });

    return { rows, bestIdx };
  }, [basketTotals, preferredStoreName_col, oneStoreName_col]);

  const recommendations = useMemo(() => {
    if (!preferredStoreId) return [];
    return prices
      .flatMap((p) => {
        const allEntries = Object.entries(p.prices || {})
          .map(([id, v]) => [id, Number(v)] as [string, number])
          .filter(([, v]) => v > 0);
        const preferredEntry = allEntries.find(([id]) => id === preferredStoreId);
        if (!preferredEntry) return [];
        const others = allEntries.filter(([id]) => id !== preferredStoreId);
        if (!others.length) return [];
        const cheapest = others.reduce((min, e) => (e[1] < min[1] ? e : min));
        const savings = preferredEntry[1] - cheapest[1];
        if (savings <= 0) return [];
        return [{ itemName: p.itemName, preferredPrice: preferredEntry[1], cheapestPrice: cheapest[1], cheapestStore: storeById.get(cheapest[0])?.name ?? 'Unknown', savings }];
      })
      .sort((a, b) => b.savings - a.savings)
      .slice(0, 5);
  }, [prices, preferredStoreId, storeById]);

  if (loading) {
    return <div className="page-container py-8 text-sm text-muted-foreground">Loading comparison data...</div>;
  }

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-foreground mb-1 pt-2">Price Comparison</h1>
      {warning && (
        <div className="ios-card mb-4 border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {warning}
        </div>
      )}
      <p className="text-sm text-muted-foreground mb-1">{shoppingListItems.length} items in your list</p>
      {/* <p className="text-xs text-muted-foreground mb-3">Searching stores within {searchRadius} miles</p> */}

      {/* <div className="mb-4 space-y-2">
        <label htmlFor="comparison-zip" className="block text-xs font-medium text-muted-foreground">Adjust ZIP code</label>
        <div className="flex gap-2">
          <input
            id="comparison-zip"
            value={manualZip}
            onChange={(e) => setManualZip(e.target.value)}
            placeholder="Enter ZIP"
            className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm"
          />
          <button
            onClick={() => geocodeZip(manualZip)}
            disabled={isGeocoding}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
          >
            {isGeocoding ? 'Checking...' : 'Set ZIP'}
          </button>
        </div>
        {geocodeError && <p className="text-xs text-destructive">{geocodeError}</p>}
        {zipLocationName && !geocodeError && <p className="text-xs text-gray-400">{zipLocationName}</p>}
      </div> */}

      {shoppingListItems.length === 0 ? (
        <div className="ios-card">
          <p className="text-center text-muted-foreground py-8">Add items to your shopping list to compare prices.</p>
        </div>
      ) : unifiedRows.length === 0 ? (
        <div className="ios-card">
          <p className="text-center text-muted-foreground py-8">No comparison data available.</p>
        </div>
      ) : (
        <div className="ios-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left font-semibold">Items</TableHead>
                <TableHead className="text-left font-semibold text-xs">
                  {preferredStoreName_col}
                </TableHead>
                <TableHead className="text-left font-semibold text-xs">{oneStoreName_col}</TableHead>
                <TableHead className="text-left font-semibold text-xs">Multi Shop</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unifiedRows.map((row) => (
                <TableRow key={row.itemName}>
                  <TableCell className="font-medium text-xs">{row.itemName}</TableCell>
                  <TableCell className="text-xs">{row.preferredPrice}</TableCell>
                  <TableCell className="text-xs">{row.oneStorePrice}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium">{row.multiShopPrice}</span>
                    {row.multiShopStore && row.multiShopStore !== '—' && (
                      <span className="block text-xs text-muted-foreground leading-tight">{row.multiShopStore}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold text-xs">Basket Cost</TableCell>
                <TableCell className="font-bold text-xs">{basketTotals.preferred}</TableCell>
                <TableCell className="font-bold text-xs">{basketTotals.oneStore}</TableCell>
                <TableCell className="font-bold text-xs">{basketTotals.multiShop}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-bold text-xs text-green-700">Savings</TableCell>
                <TableCell className="text-xs text-muted-foreground">—</TableCell>
                <TableCell className="text-xs font-semibold text-green-700">
                  {savingsSummary.rows[1].savingsVsPref != null && savingsSummary.rows[1].savingsVsPref > 0
                    ? `$${savingsSummary.rows[1].savingsVsPref.toFixed(2)}`
                    : '—'}
                </TableCell>
                <TableCell className="text-xs font-semibold text-green-700">
                  {savingsSummary.rows[2].savingsVsPref != null && savingsSummary.rows[2].savingsVsPref > 0
                    ? `$${savingsSummary.rows[2].savingsVsPref.toFixed(2)}`
                    : '—'}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">— : item not available at this store</p>
        </div>
      )}

      {/* Savings Summary */}
      {/* {unifiedRows.length > 0 && (
        <div className="ios-card mt-4">
          <p className="text-sm font-semibold text-foreground mb-1">Savings Summary</p>
          <p className="text-xs text-muted-foreground mb-3">Basket cost across shopping strategies</p>
          <div>
            {savingsSummary.rows.map((entry, i) => (
              <div
                key={entry.label}
                className={`flex items-center justify-between py-2.5 border-b border-border/40 last:border-0 ${
                  i === savingsSummary.bestIdx ? 'rounded-lg bg-green-50 -mx-4 px-4' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{entry.label}</p>
                  {entry.isBaseline && (
                    <p className="text-[0.6rem] text-muted-foreground leading-none mt-0.5">your store · baseline</p>
                  )}
                  {i === savingsSummary.bestIdx && !entry.isBaseline && (
                    <p className="text-[0.6rem] text-green-600 font-semibold leading-none mt-0.5 uppercase tracking-wide">Best Deal</p>
                  )}
                </div>
                <div className="text-right ml-4 shrink-0">
                  <p className="text-xs font-bold text-foreground">
                    {entry.total != null ? `$${entry.total.toFixed(2)}` : '—'}
                  </p>
                  {entry.savingsVsPref != null && entry.savingsVsPref > 0 && (
                    <p className="text-[0.65rem] text-green-600 font-semibold leading-none mt-0.5">
                      Save ${entry.savingsVsPref.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )} */}

      {/* {recommendations.length > 0 && (
        <div className="ios-card mt-4">
          <p className="text-sm font-semibold text-foreground mb-1">Buy Elsewhere &amp; Save</p>
          <p className="text-xs text-muted-foreground mb-3">
            Items cheaper at another store than {preferredStoreName_col}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left text-xs font-medium text-muted-foreground pb-2">Item</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground pb-2">Your Store</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground pb-2">Best Price</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground pb-2">Save</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recommendations.map((rec) => (
                <TableRow key={rec.itemName}>
                  <TableCell className="text-xs font-medium capitalize">{rec.itemName}</TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground">${rec.preferredPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-xs text-right">
                    <span className="font-semibold text-primary">${rec.cheapestPrice.toFixed(2)}</span>
                    <span className="block text-[0.65rem] text-muted-foreground">{rec.cheapestStore}</span>
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold text-green-600">
                    -${rec.savings.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )} */}
    </div>
  );
};

export default ComparisonScreen;

function getSessionShoppingListItems(): ShoppingListItem[] {
  try {
    const raw = globalThis.sessionStorage.getItem(SHOPPING_LIST_SESSION_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is ShoppingListItem => {
      return Boolean(item && typeof item.name === 'string' && typeof item.id === 'string');
    });
  } catch {
    return [];
  }
}
