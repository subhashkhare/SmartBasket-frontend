import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { APIProvider, Map, AdvancedMarker, InfoWindow } from '@vis.gl/react-google-maps';
import { PriceObservation, Store } from '@/types';
import { GOOGLE_MAPS_API_KEY } from '@/lib/maps-config';
import { optimizeStopOrder, distanceBetween, RouteStop } from '@/lib/route-optimizer';
import { motion } from 'framer-motion';
import { Navigation, Clock, Route, ChevronRight, Crown, AlertTriangle } from 'lucide-react';
import { apiService } from '@/lib/api';

// User's approximate location (Beverly Hills mock)
const USER_LOCATION = { lat: 34.0736, lng: -118.4004 };
const DEFAULT_SEARCH_RADIUS = 10;

function getStoredMapSettings(): { zipCode: string; searchRadius: number } {
  try {
    const raw = globalThis.localStorage.getItem('smartCartSession');
    if (!raw) return { zipCode: '', searchRadius: DEFAULT_SEARCH_RADIUS };
    const parsed = JSON.parse(raw) as { zipCode?: string; searchRadius?: unknown };
    const parsedRadius = Number(parsed.searchRadius);
    return {
      zipCode: parsed.zipCode || '',
      searchRadius: Number.isFinite(parsedRadius) ? parsedRadius : DEFAULT_SEARCH_RADIUS,
    };
  } catch {
    return { zipCode: '', searchRadius: DEFAULT_SEARCH_RADIUS };
  }
}

type StoreComparison = {
  store: Store;
  totalCost: number;
};

const StoreMap = () => {
  const location = useLocation();
  const locationState = location.state as { highlightStoreIds?: string[]; autoShowRoute?: boolean } | null;
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const highlightStoreIdsFromQuery = useMemo(() => {
    const raw = queryParams.get('highlightStoreIds') || '';
    const parsedIds = raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
    return Array.from(new Set(parsedIds));
  }, [queryParams]);
  const autoShowRouteFromQuery = queryParams.get('autoShowRoute') === '1' || queryParams.get('autoShowRoute') === 'true';
  const highlightStoreIds: string[] = locationState?.highlightStoreIds?.length
    ? locationState.highlightStoreIds
    : highlightStoreIdsFromQuery;
  const autoShowRoute: boolean = locationState?.autoShowRoute ?? autoShowRouteFromQuery;

  const [stores, setStores] = useState<Store[]>([]);
  const [prices, setPrices] = useState<PriceObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapsLoadError, setMapsLoadError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [userLocation, setUserLocation] = useState(USER_LOCATION);
  const [searchRadius] = useState(() => getStoredMapSettings().searchRadius);
  const hasApiKey = GOOGLE_MAPS_API_KEY.length > 0;

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setLoadError(null);

      const [storesResp, pricesResp] = await Promise.all([
        apiService.getStores(),
        apiService.getPrices(),
      ]);

      if (storesResp.error) {
        setLoadError(storesResp.error);
      }
      if (pricesResp.error) {
        setLoadError(pricesResp.error);
      }

      if (storesResp.data) setStores(storesResp.data);
      if (pricesResp.data) setPrices(pricesResp.data);

      setLoading(false);
    };

    void loadData();
  }, []);

  useEffect(() => {
    const { zipCode } = getStoredMapSettings();
    if (!/^\d{5}$/.test(zipCode)) return;

    const geocode = async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(zipCode)}&countrycodes=us&limit=1`,
          { headers: { 'User-Agent': 'smart-cart-saver-app/1.0' } }
        );
        const results = await response.json();
        if (!Array.isArray(results) || results.length === 0) return;
        setUserLocation({ lat: Number.parseFloat(results[0].lat), lng: Number.parseFloat(results[0].lon) });
      } catch {
        // Fall back to default center.
      }
    };

    void geocode();
  }, []);

  useEffect(() => {
    // Google Maps calls this global hook for key/auth-related failures.
    const previousHandler = (globalThis as { gm_authFailure?: () => void }).gm_authFailure;
    (globalThis as { gm_authFailure?: () => void }).gm_authFailure = () => {
      setMapsLoadError('Google Maps API key is invalid or not activated for Maps JavaScript API. Showing fallback store locator.');
      if (typeof previousHandler === 'function') {
        previousHandler();
      }
    };

    return () => {
      (globalThis as { gm_authFailure?: () => void }).gm_authFailure = previousHandler;
    };
  }, []);

  useEffect(() => {
    if (!hasApiKey || mapsLoadError || isMapReady) return;

    // Prevent a permanent blank map if script loads but map never renders tiles.
    const timeout = globalThis.setTimeout(() => {
      setMapsLoadError('Google Maps did not finish rendering. Showing fallback store locator.');
    }, 8000);

    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [hasApiKey, isMapReady, mapsLoadError]);

  if (!hasApiKey || mapsLoadError) {
    return (
      <StoreMapFallback
        stores={stores}
        prices={prices}
        loading={loading}
        loadError={loadError}
        userLocation={userLocation}
        searchRadius={searchRadius}
        highlightStoreIds={highlightStoreIds}
        mapUnavailableReason={mapsLoadError}
      />
    );
  }

  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      onError={(error) => {
        console.error('Google Maps API failed to load', error);
        setMapsLoadError('Google Maps JavaScript API is not enabled for this key. Showing fallback store locator.');
      }}
    >
      <StoreMapWithGoogle stores={stores} prices={prices} loading={loading} loadError={loadError} userLocation={userLocation} searchRadius={searchRadius} highlightStoreIds={highlightStoreIds} autoShowRoute={autoShowRoute} onMapReady={() => setIsMapReady(true)} />
    </APIProvider>
  );
};

/** Full Google Maps version */
const StoreMapWithGoogle = ({
  stores,
  prices,
  loading,
  loadError,
  userLocation,
  searchRadius,
  highlightStoreIds,
  autoShowRoute,
  onMapReady,
}: {
  stores: Store[];
  prices: PriceObservation[];
  loading: boolean;
  loadError: string | null;
  userLocation: { lat: number; lng: number };
  searchRadius: number;
  highlightStoreIds: string[];
  autoShowRoute: boolean;
  onMapReady: () => void;
}) => {
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [showRoute, setShowRoute] = useState(autoShowRoute);

  const visibleStores = useMemo(
    () => stores.filter((store) => distanceBetween({ ...store, lat: userLocation.lat, lng: userLocation.lng } as Store, store) <= searchRadius),
    [searchRadius, stores, userLocation]
  );

  const comparisons: StoreComparison[] = useMemo(() => {
    if (!visibleStores.length) return [];

    const totals = new Map<string, number>();
    for (const store of visibleStores) {
      totals.set(store._id || String(store.id), 0);
    }

    for (const row of prices) {
      const priceMap = row.prices || {};
      for (const [storeId, value] of Object.entries(priceMap)) {
        if (!totals.has(storeId)) continue;
        totals.set(storeId, (totals.get(storeId) || 0) + Number(value || 0));
      }
    }

    return visibleStores
      .map((store) => ({
        store,
        totalCost: Number((totals.get(store._id || String(store.id)) || 0).toFixed(2)),
      }))
      .filter((entry) => entry.totalCost > 0)
      .sort((a, b) => a.totalCost - b.totalCost);
  }, [prices, visibleStores]);

  const selectedStoreComparison = selectedStore
    ? comparisons.find((c) => (c.store._id || String(c.store.id)) === (selectedStore._id || String(selectedStore.id)))
    : undefined;

  // Multi-stop optimized route
  const routeStops: RouteStop[] = useMemo(() => {
    const topStores = comparisons.slice(0, 2);
    if (!topStores.length) return [];

    const maxTotal = topStores[topStores.length - 1].totalCost;
    const stops: RouteStop[] = topStores.map(({ store, totalCost }) => {
      const storeId = store._id || String(store.id);
      const topItems = prices
        .filter((p) => p.prices?.[storeId] !== undefined)
        .sort((a, b) => Number(a.prices?.[storeId] || 0) - Number(b.prices?.[storeId] || 0))
        .slice(0, 3)
        .map((p) => p.itemName);

      return {
        store,
        items: topItems,
        savings: Number((maxTotal - totalCost).toFixed(2)),
      };
    });

    return optimizeStopOrder(userLocation.lat, userLocation.lng, stops);
  }, [comparisons, prices, userLocation.lat, userLocation.lng]);

  const totalSavings = routeStops.reduce((s, r) => s + r.savings, 0);
  const cheapestTotal = comparisons.length ? Math.min(...comparisons.map((c) => c.totalCost)) : 0;

  if (loading) {
    return <div className="page-container py-8 text-sm text-muted-foreground">Loading store data...</div>;
  }

  if (loadError) {
    return <div className="page-container py-8 text-sm text-destructive">Failed to load store data: {loadError}</div>;
  }

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-1 pt-2">
        <h1 className="text-xl font-bold text-foreground">Store Map</h1>
        <button
          onClick={() => setShowRoute(!showRoute)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tap-highlight transition-colors ${
            showRoute ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
          }`}
        >
          <Route size={12} />
          {showRoute ? 'Hide Route' : 'Show Route'}
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Stores within {searchRadius} miles</p>

      {/* Comparison route banner */}
      {highlightStoreIds.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="ios-card border-2 border-primary/30 bg-primary/5 mb-4"
        >
          <div className="flex items-center gap-2">
            <Route size={16} className="text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Comparison Route</p>
              <p className="text-xs text-muted-foreground">
                {highlightStoreIds.length} store{highlightStoreIds.length > 1 ? 's' : ''} selected from your price comparison
              </p>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full bg-primary text-primary-foreground font-semibold">
              Best Deal
            </span>
          </div>
        </motion.div>
      )}

      {/* Google Map */}
      <div className="rounded-2xl overflow-hidden border border-border mb-4" style={{ height: 320 }}>
        <Map
          defaultCenter={userLocation}
          defaultZoom={12}
          mapId="smartcart-map"
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          onTilesLoaded={onMapReady}
        >
          {/* User location marker */}
          <AdvancedMarker position={userLocation}>
            <div className="w-4 h-4 rounded-full bg-primary border-2 border-primary-foreground shadow-lg" />
          </AdvancedMarker>

          {/* Store markers */}
          {visibleStores.map((store) => {
            const storeKey = store._id || String(store.id);
            const isOnRoute = showRoute && routeStops.some((r) => (r.store._id || String(r.store.id)) === storeKey);
            const routeIdx = routeStops.findIndex((r) => (r.store._id || String(r.store.id)) === storeKey);
            const isHighlighted = highlightStoreIds.includes(storeKey);
            return (
              <AdvancedMarker
                key={storeKey}
                position={{ lat: Number(store.lat), lng: Number(store.lng) }}
                onClick={() => setSelectedStore(store)}
              >
                {(() => {
                  let markerClass: string;
                  if (isOnRoute) {
                    markerClass = 'w-10 h-10 bg-success border-success-foreground text-success-foreground text-sm font-bold';
                  } else if (isHighlighted) {
                    markerClass = 'w-10 h-10 bg-primary border-primary-foreground text-primary-foreground text-base ring-2 ring-primary ring-offset-1';
                  } else {
                    markerClass = 'w-8 h-8 bg-card border-border text-base';
                  }
                  return (
                    <div className={`flex items-center justify-center rounded-full shadow-md border-2 transition-all ${markerClass}`}>
                      {isOnRoute ? routeIdx + 1 : store.logo}
                    </div>
                  );
                })()}
              </AdvancedMarker>
            );
          })}

          {/* Info Window */}
          {selectedStore && (
            <InfoWindow
              position={{ lat: selectedStore.lat, lng: selectedStore.lng }}
              onCloseClick={() => setSelectedStore(null)}
            >
              <div className="p-1 min-w-[160px]">
                <p className="text-sm font-bold text-foreground">{selectedStore.name}</p>
                <p className="text-xs text-muted-foreground">{selectedStore.address}</p>
                {selectedStore.isMembership && (
                  <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    Membership Required
                  </span>
                )}
                {selectedStoreComparison && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground">Your list total</p>
                    <p className="text-base font-bold text-foreground">
                      ${selectedStoreComparison.totalCost.toFixed(2)}
                    </p>
                  </div>
                )}
              </div>
            </InfoWindow>
          )}
        </Map>
      </div>

      {/* Optimized Route Card */}
      {showRoute && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="ios-card border-2 border-success/30 mb-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Route size={16} className="text-success" />
            <p className="text-sm font-semibold text-foreground">Optimized Shopping Route</p>
            <span className="savings-badge ml-auto">Save ${totalSavings.toFixed(2)}</span>
          </div>
          <div className="space-y-3">
            {routeStops.map((stop, i) => (
              <div key={stop.store.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full bg-success text-success-foreground flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </div>
                  {i < routeStops.length - 1 && (
                    <div className="w-0.5 h-8 bg-success/30 mt-1" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{stop.store.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stop.items.map((item) => (
                      <span
                        key={item}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-success font-medium mt-1">Save ${stop.savings.toFixed(2)}</p>
                </div>
                {i < routeStops.length - 1 && (
                  <div className="text-right flex-shrink-0 mt-1">
                    <p className="text-[10px] text-muted-foreground">
                      {distanceBetween(routeStops[i].store, routeStops[i + 1].store).toFixed(1)} mi
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Store List */}
      <p className="section-title">Nearby Stores</p>
      <div className="space-y-2">
        {visibleStores.map((store, i) => {
          const storeKey = store._id || String(store.id);
          const comp = comparisons.find((c) => (c.store._id || String(c.store.id)) === storeKey);
          const cheapest = comp?.totalCost === cheapestTotal;
          const milesAway = distanceBetween({ ...store, lat: userLocation.lat, lng: userLocation.lng } as Store, store);
          const isHighlighted = highlightStoreIds.includes(storeKey);
          return (
            <motion.div
              key={storeKey}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={`ios-card flex items-center gap-3 tap-highlight ${isHighlighted ? 'border-2 border-primary/50 bg-primary/5' : ''}`}
              onClick={() => setSelectedStore(store)}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${isHighlighted ? 'bg-primary/20' : 'bg-secondary'}`}>
                {store.logo}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{store.name}</p>
                  {cheapest && <Crown size={12} className="text-warning" />}
                  {isHighlighted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">Route</span>
                  )}
                  {store.isMembership && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Member</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{store.address}</p>
              </div>
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                {comp && (
                  <p className="text-sm font-bold text-foreground">${comp.totalCost.toFixed(2)}</p>
                )}
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Navigation size={9} />
                  <span>{milesAway.toFixed(1)} mi</span>
                </div>
              </div>
              <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

/** Fallback when no API key is configured */
const StoreMapFallback = ({
  stores,
  prices,
  loading,
  loadError,
  userLocation,
  searchRadius,
  highlightStoreIds,
  mapUnavailableReason,
}: {
  stores: Store[];
  prices: PriceObservation[];
  loading: boolean;
  loadError: string | null;
  userLocation: { lat: number; lng: number };
  searchRadius: number;
  highlightStoreIds: string[];
  mapUnavailableReason?: string | null;
}) => {
  const visibleStores = useMemo(
    () => stores.filter((store) => distanceBetween({ ...store, lat: userLocation.lat, lng: userLocation.lng } as Store, store) <= searchRadius),
    [searchRadius, stores, userLocation]
  );

  const comparisons: StoreComparison[] = useMemo(() => {
    if (!visibleStores.length) return [];
    const totals = new Map<string, number>();
    for (const s of visibleStores) totals.set(s._id || String(s.id), 0);
    for (const row of prices) {
      const priceMap = row.prices || {};
      for (const [storeId, value] of Object.entries(priceMap)) {
        if (!totals.has(storeId)) continue;
        totals.set(storeId, (totals.get(storeId) || 0) + Number(value || 0));
      }
    }
    return visibleStores
      .map((store) => ({
        store,
        totalCost: Number((totals.get(store._id || String(store.id)) || 0).toFixed(2)),
      }))
      .filter((entry) => entry.totalCost > 0)
      .sort((a, b) => a.totalCost - b.totalCost);
  }, [visibleStores, prices]);

  const cheapestTotal = comparisons.length ? Math.min(...comparisons.map((c) => c.totalCost)) : 0;

  if (loading) {
    return <div className="page-container py-8 text-sm text-muted-foreground">Loading store data...</div>;
  }

  if (loadError) {
    return <div className="page-container py-8 text-sm text-destructive">Failed to load store data: {loadError}</div>;
  }

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-foreground mb-1 pt-2">Store Map</h1>
      <p className="text-sm text-muted-foreground mb-4">Stores within {searchRadius} miles</p>

      {/* Comparison route banner */}
      {highlightStoreIds.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="ios-card border-2 border-primary/30 bg-primary/5 mb-4"
        >
          <div className="flex items-center gap-2">
            <Route size={16} className="text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Comparison Route</p>
              <p className="text-xs text-muted-foreground">
                {highlightStoreIds.length} store{highlightStoreIds.length > 1 ? 's' : ''} selected from your price comparison
              </p>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full bg-primary text-primary-foreground font-semibold">
              Best Deal
            </span>
          </div>
        </motion.div>
      )}

      {/* API key notice */}
      <div className="ios-card border border-warning/30 bg-warning/5 mb-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">Google Maps unavailable</p>
            {mapUnavailableReason && (
              <p className="text-xs text-foreground/80 mt-1">{mapUnavailableReason}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Add a valid key in <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">src/lib/maps-config.ts</code> and make sure Maps JavaScript API is enabled on your Google Cloud project.
            </p>
          </div>
        </div>
      </div>

      {/* Static visual map */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative rounded-2xl bg-secondary/50 overflow-hidden mb-5 border border-border"
        style={{ height: 280 }}
      >
        {/* Grid lines to suggest a map */}
        <div className="absolute inset-0 opacity-10">
          {Array.from({ length: 8 }).map((_, i) => {
            const topPercent = `${(i + 1) * 12.5}%`;
            return <div key={`h-${topPercent}`} className="absolute w-full h-px bg-foreground" style={{ top: topPercent }} />;
          })}
          {Array.from({ length: 8 }).map((_, i) => {
            const leftPercent = `${(i + 1) * 12.5}%`;
            return <div key={`v-${leftPercent}`} className="absolute h-full w-px bg-foreground" style={{ left: leftPercent }} />;
          })}
        </div>

        {/* User position */}
        <div className="absolute" style={{ top: '45%', left: '48%', transform: 'translate(-50%, -50%)' }}>
          <div className="w-4 h-4 rounded-full bg-primary border-2 border-card shadow-lg" />
          <div className="absolute -inset-3 rounded-full bg-primary/20 animate-ping" />
        </div>

        {/* Store pins */}
        {visibleStores.map((store, i) => {
          const positions = [
            { top: '22%', left: '32%' },
            { top: '48%', left: '72%' },
            { top: '72%', left: '20%' },
            { top: '30%', left: '55%' },
            { top: '58%', left: '45%' },
          ];
          const pos = positions[i % positions.length];
          return (
            <motion.div
              key={store._id || String(store.id)}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2 + i * 0.1, type: 'spring' }}
              className="absolute"
              style={{ ...pos, transform: 'translate(-50%, -50%)' }}
            >
              <div className={`w-9 h-9 rounded-full shadow-md border flex items-center justify-center text-sm ${
                highlightStoreIds.includes(store._id || String(store.id))
                  ? 'bg-primary border-primary-foreground text-primary-foreground ring-2 ring-primary ring-offset-1'
                  : 'bg-card border-border'
              }`}>
                {store.logo}
              </div>
              <p className="text-[8px] font-semibold text-foreground text-center mt-0.5 whitespace-nowrap">
                {store.name}
              </p>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Store list (same as Google version) */}
      <p className="section-title">Nearby Stores</p>
      <div className="space-y-2">
        {visibleStores.map((store, i) => {
          const storeKey = store._id || String(store.id);
          const comp = comparisons.find((c) => (c.store._id || String(c.store.id)) === storeKey);
          const cheapest = comp?.totalCost === cheapestTotal;
          const milesAway = distanceBetween({ ...store, lat: userLocation.lat, lng: userLocation.lng } as Store, store);
          const isHighlighted = highlightStoreIds.includes(storeKey);
          return (
            <motion.div
              key={storeKey}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={`ios-card flex items-center gap-3 ${isHighlighted ? 'border-2 border-primary/50 bg-primary/5' : ''}`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${isHighlighted ? 'bg-primary/20' : 'bg-secondary'}`}>
                {store.logo}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{store.name}</p>
                  {cheapest && <Crown size={12} className="text-warning" />}
                  {isHighlighted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">Route</span>
                  )}
                  {store.isMembership && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Member</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{store.address}</p>
              </div>
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                {comp && (
                  <p className="text-sm font-bold text-foreground">${comp.totalCost.toFixed(2)}</p>
                )}
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Navigation size={9} />
                  <span>{milesAway.toFixed(1)} mi</span>
                  <span className="mx-0.5">·</span>
                  <Clock size={9} />
                  <span>{4 + i * 2} min</span>
                </div>
              </div>
              <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default StoreMap;
