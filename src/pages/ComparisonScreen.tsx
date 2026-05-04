import { motion } from 'framer-motion';
import { ArrowRight, Store as StoreIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RouteStop } from '@/lib/route-optimizer';
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
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchRadius] = useState(() => getStoredSearchRadius());
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [prices, setPrices] = useState<PriceObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const optimizedRoute = location.state?.optimizedRoute as RouteStop[] | undefined;
  const initialMode = location.state?.mode as OptimizerMode | undefined;
  const routeStopsForView = optimizedRoute ?? [];

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      const [storesResp, pricesResp] = await Promise.all([apiService.getStores(), apiService.getPrices()]);
      if (storesResp.error) setLoadError(storesResp.error);
      if (pricesResp.error) setLoadError(pricesResp.error);
      if (storesResp.data) setStores(storesResp.data);
      if (pricesResp.data) setPrices(pricesResp.data);
      setLoading(false);
    };

    void load();
  }, []);

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
    } catch (err) {
      setGeocodeError('Geocoding failed - try again');
      console.error('Geocoding error', err);
    } finally {
      setIsGeocoding(false);
    }
  };

  const openGoogleMapsStore = (store: Store) => {
    const params = new URLSearchParams({ api: '1', query: `${store.lat},${store.lng}` });
    const url = `https://www.google.com/maps/search/?${params.toString()}`;
    window.open(url, '_blank');
  };

  const multiStopRouteStores = optimizedRoute
    ? optimizedRoute.map((stop) => stop.store)
    : sorted.slice(0, 2).map((comp) => comp.store);

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

  const preferredStore = useMemo(
    () => stores.find((s) => s.name === preferredStoreName),
    [preferredStoreName, stores]
  );

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
  const ctaStoreIds = useMemo(() => {
    const ids = (mode === 'multi-stop' ? multiStopRouteStores : sorted.slice(0, 3).map((comp) => comp.store))
      .map((store) => store._id || String(store.id))
      .filter((id) => id.length > 0);

    if (ids.length > 0) return ids;
    return effectiveBestStoreId ? [effectiveBestStoreId] : [];
  }, [effectiveBestStoreId, mode, multiStopRouteStores, sorted]);

  const openMapInNewTab = () => {
    const params = new URLSearchParams();
    if (ctaStoreIds.length > 0) {
      params.set('highlightStoreIds', ctaStoreIds.join(','));
    }
    if (mode === 'multi-stop') {
      params.set('autoShowRoute', '1');
    }

    const mapPath = params.toString() ? `/map?${params.toString()}` : '/map';
    const mapUrl = `${globalThis.location.origin}${mapPath}`;
    const opened = window.open(mapUrl, '_blank', 'noopener,noreferrer');

    // Fallback if popup is blocked by browser settings.
    if (!opened) {
      globalThis.location.assign(mapPath);
    }
  };

  const tableData: TableRowData[] = useMemo(() => {
    const effectiveBestStoreName = bestSingleStore?.store.name || storeById.get(effectiveBestStoreId)?.name || 'Best Store';
    return comparisonRows.map(({ item, matchedPrice }) => {
      if (!matchedPrice) {
        return {
          itemName: item.name,
          preferredStore: { primary: '0', secondary: 'No price found for this item' },
          oneStore: { primary: '0', secondary: 'No price found for this item' },
          multiStore: { primary: '0', secondary: 'No nearby store price' },
        };
      }

      const row = matchedPrice;
      const priceEntries = Object.entries(row.prices || {}).filter(([, value]) => Number(value) > 0);
      const sortedEntries = [...priceEntries].sort((a, b) => Number(a[1]) - Number(b[1]));
      const multiStoreBest = sortedEntries[0];
      const preferredStorePrice = row.prices?.[preferredStoreId];
      const oneStorePrice = row.prices?.[effectiveBestStoreId];
      const multiStoreName = multiStoreBest ? storeById.get(multiStoreBest[0])?.name || 'Store' : 'Unavailable';
      const multiStorePrice = Number(multiStoreBest?.[1] || 0);
      const preferredStoreDisplay: PriceCell = preferredStorePrice === undefined
        ? { primary: '0', secondary: `${preferredStore?.name || 'Preferred store'} unavailable` }
        : { primary: `$${Number(preferredStorePrice).toFixed(2)}`, secondary: preferredStore?.name || 'Preferred store' };
      const oneStoreDisplay: PriceCell = oneStorePrice === undefined
        ? { primary: '0', secondary: `${effectiveBestStoreName} unavailable` }
        : { primary: `$${Number(oneStorePrice).toFixed(2)}`, secondary: effectiveBestStoreName };
      const multiStoreDisplay: PriceCell = multiStoreBest
        ? { primary: `$${multiStorePrice.toFixed(2)}`, secondary: multiStoreName }
        : { primary: '0', secondary: 'No store price' };

      return {
        itemName: item.name,
        preferredStore: preferredStoreDisplay,
        oneStore: oneStoreDisplay,
        multiStore: multiStoreDisplay,
      };
    });
  }, [bestSingleStore, effectiveBestStoreId, comparisonRows, preferredStore, preferredStoreId, storeById]);

  const totals = useMemo(() => {
    let preferred = 0;
    let oneStore = 0;
    let multiStore = 0;
    let preferredComplete = true;
    let oneStoreComplete = true;

    for (const item of tableData) {
      if (item.preferredStore.primary === '0') {
        preferredComplete = false;
      } else {
        preferred += Number.parseFloat(item.preferredStore.primary.replace('$', '')) || 0;
      }

      if (item.oneStore.primary === '0') {
        oneStoreComplete = false;
      } else {
        oneStore += Number.parseFloat(item.oneStore.primary.replace('$', '')) || 0;
      }

      if (item.multiStore.primary !== '0') {
        multiStore += Number.parseFloat(item.multiStore.primary.replace('$', '')) || 0;
      }
    }

    return {
      preferred: preferredComplete ? preferred : null,
      oneStore: oneStoreComplete ? oneStore : null,
      multiStore,
    };
  }, [tableData]);

  let comparisonContent;
  if (shoppingListItems.length === 0) {
    comparisonContent = (
      <div className="ios-card">
        <p className="text-center text-muted-foreground py-8">Add items to your shopping list to compare prices.</p>
      </div>
    );
  } else if (tableData.length > 0) {
    comparisonContent = (
      <div className="ios-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-left font-semibold">Items</TableHead>
              <TableHead className="text-left font-semibold">Preferred Store</TableHead>
              <TableHead className="text-left font-semibold">Best Single-Store Basket</TableHead>
              <TableHead className="text-left font-semibold">Best Multi-Store Combo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableData.map((row) => (
              <TableRow key={row.itemName}>
                <TableCell className="font-medium">{row.itemName}</TableCell>
                <TableCell>
                  <div className="font-medium">{row.preferredStore.primary}</div>
                  <div className="text-[10px] text-muted-foreground">{row.preferredStore.secondary}</div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{row.oneStore.primary}</div>
                  <div className="text-[10px] text-muted-foreground">{row.oneStore.secondary}</div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{row.multiStore.primary}</div>
                  <div className="text-[10px] text-muted-foreground">{row.multiStore.secondary}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">Total Cost</TableCell>
              <TableCell className="font-bold">{totals.preferred === null ? '0' : `$${totals.preferred.toFixed(2)}`}</TableCell>
              <TableCell className="font-bold">{totals.oneStore === null ? '0' : `$${totals.oneStore.toFixed(2)}`}</TableCell>
              <TableCell className="font-bold">${totals.multiStore.toFixed(2)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">0 : item not available in store</p>
      </div>
    );
  } else {
    comparisonContent = (
      <div className="ios-card">
        <p className="text-center text-muted-foreground py-8">No comparison data available</p>
      </div>
    );
  }

  if (loading) {
    return <div className="page-container py-8 text-sm text-muted-foreground">Loading comparison data...</div>;
  }

  if (loadError) {
    return <div className="page-container py-8 text-sm text-destructive">Failed to load comparison data: {loadError}</div>;
  }

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-foreground mb-1 pt-2">Price Comparison</h1>
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

      <div className="flex flex-wrap gap-2 mb-3">
        {sorted.slice(0, 3).map((comp) => (
          <button
            key={comp.store._id || String(comp.store.id)}
            onClick={() => openGoogleMapsStore(comp.store)}
            className="h-9 px-3 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition"
          >
            Locate {comp.store.name}
          </button>
        ))}
      </div>

      

      {mode === 'multi-stop' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
          <div className="ios-card border-2 border-success/40">
            <div className="flex items-center gap-2 mb-3">
              <StoreIcon size={16} className="text-success" />
              <p className="text-sm font-semibold text-foreground">Optimal Multi-Stop Route</p>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-4">
              {routeStopsForView.length > 0 ? (
                routeStopsForView.map((stop, index) => (
                  <div key={stop.store._id || String(stop.store.id)} className="flex items-center gap-2 py-2 px-1 sm:flex-1 sm:min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-lg">
                      {stop.store.logo || '🏪'}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">{stop.store.name}</p>
                      <p className="text-[10px] text-muted-foreground">{stop.items.length} items</p>
                    </div>
                    {index < routeStopsForView.length - 1 && <ArrowRight size={14} className="text-muted-foreground ml-1 sm:mx-2" />}
                  </div>
                ))
              ) : (
                multiStopRouteStores.slice(0, 2).map((store, index) => (
                  <div key={store._id || String(store.id)} className="flex items-center gap-2 flex-1">
                    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-lg">{store.logo || '🏪'}</div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">{store.name}</p>
                      <p className="text-[10px] text-muted-foreground">Best-value stop</p>
                    </div>
                    {index < Math.min(2, multiStopRouteStores.length) - 1 && <ArrowRight size={14} className="text-muted-foreground" />}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground">Total Cost</p>
                <p className="text-lg font-bold text-foreground">${totals.multiStore.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">You Save</p>
                <p className="text-lg font-bold text-success">${Math.max(0, (totals.oneStore ?? totals.multiStore) - totals.multiStore).toFixed(2)}</p>
              </div>
            </div>
          </div>

        </motion.div>
      )}
      <button
        onClick={openMapInNewTab}
        disabled={shoppingListItems.length === 0}
        className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 tap-highlight active:scale-[0.97] transition-transform mt-5 mb-5"
      >
        <StoreIcon size={18} />
        {mode === 'multi-stop' ? 'View Route on Map' : 'Show Stores in Map'}
      </button>
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
