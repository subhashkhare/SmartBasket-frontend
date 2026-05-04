import { Store } from '@/types';

export interface RouteStop {
  store: Store;
  items: string[];
  savings: number;
}

export interface OptimizedRoute {
  stops: RouteStop[];
  totalSavings: number;
  totalDistance: string;
  totalDuration: string;
}

/**
 * Simple nearest-neighbor route optimization for multi-stop shopping.
 * Given a starting point and a list of stores to visit, returns them
 * in an order that minimizes total travel.
 */
export function optimizeStopOrder(
  userLat: number,
  userLng: number,
  stops: RouteStop[]
): RouteStop[] {
  if (stops.length <= 1) return stops;

  const remaining = [...stops];
  const ordered: RouteStop[] = [];
  let currentLat = userLat;
  let currentLng = userLng;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(currentLat, currentLng, remaining[i].store.lat, remaining[i].store.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    const next = remaining.splice(nearestIdx, 1)[0];
    ordered.push(next);
    currentLat = next.store.lat;
    currentLng = next.store.lng;
  }

  return ordered;
}

/** Haversine distance in miles */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
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

/** Calculate distance between two stores in miles */
export function distanceBetween(a: Store, b: Store): number {
  return haversine(a.lat, a.lng, b.lat, b.lng);
}
