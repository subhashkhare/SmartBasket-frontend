import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** Returns '/scanner' if the user has no receipt within 15 days, otherwise '/'. */
export function getPostLoginDest(rawPhone: string, lastScannedAt?: string | null): '/' | '/scanner' {
  const withinDays = (iso: string) =>
    (Date.now() - new Date(iso).getTime()) / 86_400_000 <= 15;

  // 1. Trust the DB value if the server returned one
  if (lastScannedAt) return withinDays(lastScannedAt) ? '/' : '/scanner';

  // 2. Fall back to localStorage stamp written by ScannerView
  try {
    const phone = normalizePhone(rawPhone);
    const raw = globalThis.localStorage?.getItem('smartCartLastScan');
    if (raw) {
      const { userKey, timestamp } = JSON.parse(raw) as { userKey: string; timestamp: string };
      if (normalizePhone(userKey) === phone) {
        return withinDays(timestamp) ? '/' : '/scanner';
      }
    }
  } catch { /* ignore */ }

  return '/scanner';
}
