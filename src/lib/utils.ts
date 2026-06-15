import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export type ScanState = 'new' | 'recent' | 'stale' | 'locked';

function stateFromDays(days: number): Exclude<ScanState, 'new'> {
  if (days <= 15) return 'recent';
  if (days <= 60) return 'stale';
  return 'locked';
}

/** Reads the last-scan timestamp from localStorage for the given phone. */
export function getLocalLastScan(rawPhone: string): { days: number; timestamp: string } | null {
  try {
    const phone = normalizePhone(rawPhone);
    const raw = globalThis.localStorage?.getItem('smartCartLastScan');
    if (!raw) return null;
    const { userKey, timestamp } = JSON.parse(raw) as { userKey: string; timestamp: string };
    if (normalizePhone(userKey) !== phone) return null;
    return { days: daysSince(timestamp), timestamp };
  } catch {
    return null;
  }
}

/**
 * Saves the server's lastScannedAt to localStorage only when it's newer than what
 * is already stored. Called right after login so ScanGuard works on any device.
 */
export function persistServerLastScan(rawPhone: string, lastScannedAt: string): void {
  try {
    const raw = globalThis.localStorage?.getItem('smartCartLastScan');
    if (raw) {
      const existing = JSON.parse(raw) as { userKey: string; timestamp: string };
      if (new Date(existing.timestamp) >= new Date(lastScannedAt)) return;
    }
    globalThis.localStorage?.setItem('smartCartLastScan', JSON.stringify({
      userKey: rawPhone,
      timestamp: lastScannedAt,
    }));
  } catch { /* ignore */ }
}

/**
 * Returns the preferred store name from localStorage (raw casing, trimmed).
 * Checks smartCartSession first, falls back to smartCartUser for legacy/offline data.
 */
export function getPreferredStoreName(): string {
  try {
    for (const key of ['smartCartSession', 'smartCartUser']) {
      const raw = globalThis.localStorage?.getItem(key);
      if (!raw) continue;
      const val = (JSON.parse(raw) as { preferredStore?: string }).preferredStore;
      if (val?.trim()) return val.trim();
    }
  } catch { /* ignore */ }
  return '';
}

/** Reads the user's zip code from localStorage (trimmed). Checks smartCartSession first, falls back to smartCartUser. */
export function getZipCode(): string {
  try {
    for (const key of ['smartCartSession', 'smartCartUser']) {
      const raw = globalThis.localStorage?.getItem(key);
      if (!raw) continue;
      const val = (JSON.parse(raw) as { zipCode?: string }).zipCode;
      if (val?.trim()) return val.trim();
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * Writes zipCode to both localStorage keys and dispatches a `zipCodeChanged` event
 * so components that stay mounted (e.g. Header) can react immediately.
 */
export function setZipCode(zip: string): void {
  const trimmed = zip.trim();
  for (const key of ['smartCartSession', 'smartCartUser']) {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.zipCode = trimmed;
      globalThis.localStorage?.setItem(key, JSON.stringify(parsed));
    } catch { /* ignore */ }
  }
  globalThis.dispatchEvent?.(new CustomEvent('zipCodeChanged', { detail: { zipCode: trimmed } }));
}

/**
 * Writes preferredStore to both localStorage keys so every screen stays in sync.
 * Only updates keys that already exist (avoids creating orphan entries).
 */
export function setPreferredStoreName(name: string): void {
  const trimmed = name.trim();
  for (const key of ['smartCartSession', 'smartCartUser']) {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.preferredStore = trimmed;
      globalThis.localStorage?.setItem(key, JSON.stringify(parsed));
    } catch { /* ignore */ }
  }
  globalThis.dispatchEvent?.(new CustomEvent('preferredStoreChanged', { detail: { name: trimmed } }));
}

/**
 * Returns the user's scan state:
 *   'new'    – never scanned
 *   'recent' – scanned ≤ 15 days ago  → Dashboard + reminder
 *   'stale'  – scanned 15–60 days ago → Scanner, free navigation
 *   'locked' – scanned > 60 days ago  → Scanner, navigation blocked
 */
export function getScanState(rawPhone: string, lastScannedAt?: string | null): ScanState {
  if (lastScannedAt) return stateFromDays(daysSince(lastScannedAt));
  const local = getLocalLastScan(rawPhone);
  if (local) return stateFromDays(local.days);
  return 'new';
}

/** Returns '/' (Dashboard) for new/recent users, '/scanner' for stale/locked. */
export function getPostLoginDest(rawPhone: string, lastScannedAt?: string | null): '/' | '/scanner' {
  const state = getScanState(rawPhone, lastScannedAt);
  return state === 'new' || state === 'recent' ? '/' : '/scanner';
}
