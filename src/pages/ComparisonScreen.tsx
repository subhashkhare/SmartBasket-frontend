import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { apiService } from '@/lib/api';
import { PriceObservation, ShoppingListItem, Store } from '@/types';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type OptimizerMode = 'one-stop' | 'multi-stop';

type StoreComparison = { store: Store; totalCost: number; coveredItemCount: number; isComplete: boolean };
type PriceCell = { primary: string; secondary: string };
type TableRowData = { itemName: string; preferredStore: PriceCell; oneStore: PriceCell; multiStore: PriceCell };

const SHOPPING_LIST_SESSION_KEY = 'smartCartShoppingListSession';
const DEFAULT_SEARCH_RADIUS = 10;

function getStoredSearchRadius(): number {
  try {
    const session = globalThis.localStorage.getItem('smartCartSession');
    if (!session) return DEFAULT_SEARCH_RADIUS;
    const parsed = JSON.parse(session) as { searchRadius?: unknown };
    const radius = Number(parsed.searchRadius);
    return Number.isFinite(radius) ? radius : DEFAULT_SEARCH_RADIUS;
  } catch {
    return DEFAULT_SEARCH_RADIUS;
  }
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

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
  const location = useLocation();
  const [mode, setMode] = useState<OptimizerMode>('one-stop');
  const [manualZip, setManualZip] = useState('');
  const [zipLocationName, setZipLocationName] = useState('');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchRadius] = useState(() => getStoredSearchRadius());
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const initialMode = location.state?.mode as OptimizerMode | undefined;

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

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

  const stores: Store[] = (!storesResp?.error && storesResp?.data) ? storesResp.data : [];
  const prices: PriceObservation[] = (!pricesResp?.error && pricesResp?.data) ? pricesResp.data : [];

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

  useEffect(() => {
    try {
      const savedUser = globalThis.localStorage.getItem('smartCartUser');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (parsed?.zipCode) {
          setManualZip(parsed.zipCode);
          void geocodeZip(parsed.zipCode);
        }
      }
    } catch (err) {
      console.error('Failed to parse user from localStorage', err);
    }
  }, []);

  const storeById = useMemo(() => {
    const m = new Map<string, Store>();
    stores.forEach((s) => m.set(s._id || String(s.id), s));
    return m;
  }, [stores]);

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
    const candidateStores = userLocation
      ? stores.filter((store) => haversine(userLocation.lat, userLocation.lng, Number(store.lat), Number(store.lng)) <= searchRadius)
      : stores;

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
  }, [filteredPrices, searchRadius, stores, userLocation]);

  const sorted = comparisons;
  const cheapest = sorted[0];

  const geocodeZip = async (zip: string) => {
    const normalized = zip.trim();
    if (!/^\d{5}$/.exec(normalized)) {
      setGeocodeError('Enter a valid 5-digit ZIP code');
      return;
    }

    setIsGeocoding(true);
    setGeocodeError(null);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(normalized)}&countrycodes=us&limit=1`,
        { headers: { 'User-Agent': 'smart-cart-saver-app/1.0' } }
      );
      const results = await response.json();

      if (!Array.isArray(results) || results.length === 0) {
        setGeocodeError('ZIP code not found');
        return;
      }

      const nextLocation = { lat: Number.parseFloat(results[0].lat), lng: Number.parseFloat(results[0].lon) };
      setUserLocation(nextLocation);
      setManualZip(normalized);
      const displayName: string = results[0].display_name || '';
      const parts = displayName.split(',').map((s: string) => s.trim());
      setZipLocationName(parts.slice(0, 2).join(', '));
    } catch (err) {
      setGeocodeError('Geocoding failed - try again');
      console.error('Geocoding error', err);
    } finally {
      setIsGeocoding(false);
    }
  };


  const preferredStoreName = useMemo(() => {
    try {
      const session = globalThis.localStorage.getItem('smartCartSession');
      if (session) {
        const parsed = JSON.parse(session);
        if (parsed?.preferredStore) return String(parsed.preferredStore);
      }
      const saved = globalThis.localStorage.getItem('smartCartUser');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.preferredStore) return String(parsed.preferredStore);
      }
    } catch {
      // ignore malformed storage
    }
    return cheapest?.store.name || '';
  }, [cheapest?.store.name]);

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

  const tableData: TableRowData[] = useMemo(() => {
    const effectiveBestStoreName = bestSingleStore?.store.name || storeById.get(effectiveBestStoreId)?.name || 'Best Store';
    return comparisonRows.map(({ item, matchedPrice }) => {
      if (!matchedPrice) {
        return {
          itemName: item.name,
          preferredStore: { primary: '0', secondary: '' },
          oneStore: { primary: '0', secondary: '' },
          multiStore: { primary: '0', secondary: '' },
        };
      }
      const preferredStorePrice = matchedPrice.prices?.[preferredStoreId];
      const oneStorePrice = matchedPrice.prices?.[effectiveBestStoreId];
      return {
        itemName: item.name,
        preferredStore: preferredStorePrice === undefined
          ? { primary: '0', secondary: '' }
          : { primary: `$${Number(preferredStorePrice).toFixed(2)}`, secondary: '' },
        oneStore: oneStorePrice === undefined
          ? { primary: '0', secondary: '' }
          : { primary: `$${Number(oneStorePrice).toFixed(2)}`, secondary: effectiveBestStoreName },
        multiStore: { primary: '0', secondary: '' },
      };
    });
  }, [bestSingleStore, effectiveBestStoreId, comparisonRows, preferredStoreId, storeById]);

  const totals = useMemo(() => {
    let preferred = 0;
    let oneStore = 0;
    let preferredComplete = true;
    let oneStoreComplete = true;
    for (const item of tableData) {
      if (item.preferredStore.primary === '0') { preferredComplete = false; }
      else { preferred += Number.parseFloat(item.preferredStore.primary.replace('$', '')) || 0; }
      if (item.oneStore.primary === '0') { oneStoreComplete = false; }
      else { oneStore += Number.parseFloat(item.oneStore.primary.replace('$', '')) || 0; }
    }
    return {
      preferred: preferredComplete ? preferred : null,
      oneStore: oneStoreComplete ? oneStore : null,
    };
  }, [tableData]);

  const multiStoreTableData = useMemo(() => {
    return comparisonRows.map(({ item, matchedPrice }) => {
      if (!matchedPrice) return { itemName: item.name, price: '0', storeName: '—' };
      const entries = Object.entries(matchedPrice.prices || {})
        .filter(([, v]) => Number(v) > 0)
        .sort(([, a], [, b]) => Number(a) - Number(b));
      if (!entries.length) return { itemName: item.name, price: '0', storeName: '—' };
      const [bestStoreId, bestPrice] = entries[0];
      return {
        itemName: item.name,
        price: `$${Number(bestPrice).toFixed(2)}`,
        storeName: storeById.get(bestStoreId)?.name || 'Unknown Store',
      };
    });
  }, [comparisonRows, storeById]);

  const multiStoreTotal = useMemo(() =>
    multiStoreTableData.reduce((sum, row) =>
      sum + (row.price === '0' ? 0 : Number(row.price.replace('$', '')) || 0), 0),
  [multiStoreTableData]);

  let comparisonContent;
  if (shoppingListItems.length === 0) {
    comparisonContent = (
      <div className="ios-card">
        <p className="text-center text-muted-foreground py-8">Add items to your shopping list to compare prices.</p>
      </div>
    );
  } else if (mode === 'one-stop') {
    comparisonContent = tableData.length > 0 ? (
      <div className="ios-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-left font-semibold">Items</TableHead>
              <TableHead className="text-left font-semibold">{preferredStore?.name || 'Preferred Store'}</TableHead>
              <TableHead className="text-left font-semibold">{bestSingleStore?.store.name || storeById.get(effectiveBestStoreId)?.name || 'Best Store'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableData.map((row) => (
              <TableRow key={row.itemName}>
                <TableCell className="font-medium">{row.itemName}</TableCell>
                <TableCell className="font-medium">{row.preferredStore.primary}</TableCell>
                <TableCell className="font-medium">{row.oneStore.primary}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">Total Cost</TableCell>
              <TableCell className="font-bold">{totals.preferred === null ? '0' : `$${totals.preferred.toFixed(2)}`}</TableCell>
              <TableCell className="font-bold">{totals.oneStore === null ? '0' : `$${totals.oneStore.toFixed(2)}`}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">0 : item not available in store</p>
      </div>
    ) : (
      <div className="ios-card">
        <p className="text-center text-muted-foreground py-8">No comparison data available</p>
      </div>
    );
  } else {
    comparisonContent = multiStoreTableData.length > 0 ? (
      <div className="space-y-4">
        {/* Per-item cheapest breakdown */}
        <div className="ios-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left font-semibold">Items</TableHead>
                <TableHead className="text-left font-semibold">Price</TableHead>
                <TableHead className="text-left font-semibold">Store</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {multiStoreTableData.map((row) => (
                <TableRow key={row.itemName}>
                  <TableCell className="font-medium">{row.itemName}</TableCell>
                  <TableCell className="font-medium">{row.price}</TableCell>
                  <TableCell className="font-medium">{row.storeName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">Total Cost</TableCell>
                <TableCell className="font-bold">${multiStoreTotal.toFixed(2)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">0 : item not available in store</p>
        </div>

        {/* Total cost comparison across all strategies */}
        <div className="ios-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Total Cost Comparison</p>
          <div className="space-y-2">
            {[
              { label: preferredStore?.name || 'Preferred Store', value: totals.preferred, highlight: false },
              { label: bestSingleStore?.store.name || storeById.get(effectiveBestStoreId)?.name || 'Best Single Store', value: totals.oneStore, highlight: false },
              { label: 'Multi-Store', value: multiStoreTotal, highlight: true },
            ].map(({ label, value, highlight }) => (
              <div key={label} className={`flex items-center justify-between rounded-lg px-3 py-2 ${highlight ? 'bg-success/10' : 'bg-muted/40'}`}>
                <span className={`text-sm font-medium ${highlight ? 'text-success' : 'text-foreground'}`}>{label}</span>
                <span className={`text-sm font-bold ${highlight ? 'text-success' : 'text-foreground'}`}>
                  {value === null ? '—' : `$${value.toFixed(2)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ) : (
      <div className="ios-card">
        <p className="text-center text-muted-foreground py-8">No comparison data available</p>
      </div>
    );
  }

  if (loading) {
    return <div className="page-container py-8 text-sm text-muted-foreground">Loading comparison data...</div>;
  }

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-foreground mb-1 pt-2">Price Comparison</h1>
      {warning ? (
        <div className="ios-card mb-4 border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {warning}
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground mb-1">{shoppingListItems.length} items in your list</p>
      <p className="text-xs text-muted-foreground mb-3">Searching stores within {searchRadius} miles</p>

      <div className="mb-4 space-y-2">
        <label htmlFor="comparison-zip" className="block text-xs font-medium text-muted-foreground">Adjust ZIP code for route</label>
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
      </div>

      <div className="flex gap-1 p-1 bg-secondary rounded-xl mb-5">
        <button
          onClick={() => setMode('one-stop')}
          className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-all tap-highlight ${
            mode === 'one-stop' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
        >
          One-Stop Shop
        </button>
        <button
          onClick={() => setMode('multi-stop')}
          className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-all tap-highlight ${
            mode === 'multi-stop' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
        >
          Multi-Stop Saver
        </button>
      </div>

      {comparisonContent}
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
