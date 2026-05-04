import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingDown, Receipt, ChevronLeft, ChevronRight, Sparkles, ArrowDownRight } from 'lucide-react';
import Header from '@/components/Header';
import { apiService } from '@/lib/api';
import { PriceObservation, Store } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Deal = { product: string; store: string; price: number; prevPrice: number; savings: number };
type RecentScan = { id: string; storeName: string; date: string; total: number; status: 'verified' | 'processing' };
type DateWiseTransaction = { date: string; transactions: number; expenses: number; savings: number };
type ReceiptHistoryEntry = {
  id: string;
  userKey: string;
  storeName: string;
  date: string;
  total: number;
  savings?: number;
  status: 'verified' | 'processing';
};

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const RECEIPT_HISTORY_KEY = 'smartCartReceiptHistory';

const resolveCurrentUserKey = (): string => {
  try {
    const session = localStorage.getItem('smartCartSession');
    if (session) {
      const parsed = JSON.parse(session);
      return parsed.phoneNumber || parsed.id || parsed.email || 'unknown';
    }
    const user = localStorage.getItem('smartCartUser');
    if (user) {
      const parsed = JSON.parse(user);
      return parsed.phoneNumber || parsed.id || parsed.email || 'unknown';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
};

const getCurrentUserZipCode = (): string => {
  try {
    const session = localStorage.getItem('smartCartSession');
    if (session) {
      const parsed = JSON.parse(session);
      return parsed.zipCode || '';
    }
    return '';
  } catch {
    return '';
  }
};

const toDateTimestamp = (value: string | undefined): number => {
  if (!value) return Date.now();
  try {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  } catch {
    return Date.now();
  }
};

const isReceiptHistoryEntry = (entry: unknown): entry is ReceiptHistoryEntry => {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as Record<string, unknown>;
  return (
    typeof candidate.userKey === 'string' &&
    typeof candidate.storeName === 'string' &&
    typeof candidate.date === 'string' &&
    typeof candidate.total === 'number' &&
    (candidate.status === 'verified' || candidate.status === 'processing')
  );
};

const getUserReceiptHistory = (userKey: string): ReceiptHistoryEntry[] => {
  try {
    const data = localStorage.getItem(RECEIPT_HISTORY_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is ReceiptHistoryEntry => {
      if (!isReceiptHistoryEntry(entry)) return false;
      return entry.userKey === userKey;
    });
  } catch {
    return [];
  }
};

const Dashboard = () => {
  const [stores, setStores] = useState<Store[]>([]);
  const [prices, setPrices] = useState<PriceObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const topDealsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setWarning(null);

      const [storesResp, pricesResp] = await Promise.allSettled([apiService.getStores(), apiService.getPrices()]);

      const storesResult =
        storesResp.status === 'fulfilled' && !storesResp.value.error ? storesResp.value.data ?? [] : [];
      const pricesResult =
        pricesResp.status === 'fulfilled' && !pricesResp.value.error ? pricesResp.value.data ?? [] : [];

      if (storesResult.length === 0 || pricesResult.length === 0) {
        const storeError =
          storesResp.status === 'rejected'
            ? 'Unable to load stores.'
            : storesResp.value?.error ?? '';
        const pricesError =
          pricesResp.status === 'rejected'
            ? 'Unable to load price data.'
            : pricesResp.value?.error ?? '';

        setWarning(
          'Live market data is currently unavailable. Showing available receipt history only.' +
            [storeError, pricesError].filter(Boolean).join(' ')
        );
      }

      setStores(storesResult);
      setPrices(pricesResult);
      setLoading(false);
    };

    void load();
  }, []);

  const topDeals: Deal[] = useMemo(() => {
    return prices
      .map((row) => {
        const entries = Object.entries(row.prices || {}).filter(([, value]) => Number(value) > 0);
        if (entries.length < 2) return null;

        const sorted = [...entries].sort((a, b) => Number(a[1]) - Number(b[1]));
        const [bestStoreId, bestPrice] = sorted[0];
        const [, worstPrice] = sorted[sorted.length - 1];
        const storeName = stores.find((s) => (s._id || String(s.id)) === bestStoreId)?.name || 'Store';
        const savingsPct = Math.round(((Number(worstPrice) - Number(bestPrice)) / Number(worstPrice)) * 100);

        return {
          product: row.itemName,
          store: storeName,
          price: Number(bestPrice),
          prevPrice: Number(worstPrice),
          savings: Number.isFinite(savingsPct) ? Math.max(0, savingsPct) : 0,
        };
      })
      .filter((d): d is Deal => Boolean(d))
      .sort((a, b) => b.savings - a.savings)
      .slice(0, 6);
  }, [prices, stores]);

  const currentUserKey = useMemo(() => resolveCurrentUserKey(), []);
  const userReceipts = useMemo(() => getUserReceiptHistory(currentUserKey), [currentUserKey]);

  const recentScans: RecentScan[] = useMemo(() => {
    return userReceipts
      .map((entry) => ({
        id: entry.id,
        storeName: entry.storeName,
        date: entry.date,
        total: entry.total,
        status: entry.status,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [userReceipts]);

  const monthlySpend = useMemo(() => {
    const cutoff = Date.now() - ONE_MONTH_MS;
    return Number(
      userReceipts
        .filter((entry) => toDateTimestamp(entry.date) >= cutoff)
        .reduce((sum, entry) => sum + entry.total, 0)
        .toFixed(2)
    );
  }, [userReceipts]);

  const totalSaved = useMemo(() => {
    const cutoff = Date.now() - ONE_MONTH_MS;
    return Number(
      userReceipts
        .filter((entry) => toDateTimestamp(entry.date) >= cutoff)
        .reduce((sum, entry) => sum + (entry.savings || 0), 0)
        .toFixed(2)
    );
  }, [userReceipts]);

  const monthlyTransactions = useMemo(() => {
    const cutoff = Date.now() - ONE_MONTH_MS;
    return userReceipts.filter((entry) => toDateTimestamp(entry.date) >= cutoff).length;
  }, [userReceipts]);

  const dateWiseTransactions = useMemo(() => {
    const cutoff = Date.now() - ONE_MONTH_MS;
    const byDate = new Map<string, DateWiseTransaction>();

    userReceipts.forEach((entry) => {
      if (toDateTimestamp(entry.date) < cutoff) return;

      const dateKey = entry.date;
      const existing = byDate.get(dateKey) || {
        date: dateKey,
        transactions: 0,
        expenses: 0,
        savings: 0,
      };

      existing.transactions += 1;
      existing.expenses += entry.total;
      existing.savings += entry.savings || 0;
      byDate.set(dateKey, existing);
    });

    return Array.from(byDate.values())
      .map((entry) => ({
        ...entry,
        expenses: Number(entry.expenses.toFixed(2)),
        savings: Number(entry.savings.toFixed(2)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [userReceipts]);

  const userZipCode = useMemo(() => getCurrentUserZipCode(), []);
  const locationLabel = userZipCode ? `ZIP ${userZipCode}` : 'Your area';

  const scrollTopDeals = (direction: 'left' | 'right') => {
    const container = topDealsRef.current;
    if (!container) return;

    const offset = Math.max(220, Math.floor(container.clientWidth * 0.8));
    const left = direction === 'left' ? -offset : offset;
    container.scrollBy({ left, behavior: 'smooth' });
  };

  if (loading) {
    return <div className="page-container py-8 text-sm text-muted-foreground">Loading dashboard data...</div>;
  }

  return (
    <div className="page-container">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">SmartCart</h1>
          <p className="text-sm text-muted-foreground">{locationLabel}</p>
        </div>
        <Header />
      </div>

      {warning ? (
        <div className="ios-card mb-4 border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {warning}
        </div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="ios-card mb-4 bg-gradient-to-br from-success/10 to-success/5 border border-success/20"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
            <TrendingDown size={20} className="text-success" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Saved This Month</p>
            <p className="text-2xl font-bold text-success">${totalSaved.toFixed(2)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ArrowDownRight size={12} className="text-success" />
            <span>1-month spend: ${monthlySpend.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Sparkles size={12} className="text-warning" />
            <span>{monthlyTransactions} transactions recorded</span>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <div className="ios-card p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-[.3em]">Monthly Transactions</p>
          <p className="text-3xl font-bold text-foreground">{monthlyTransactions}</p>
        </div>
        <div className="ios-card p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-[.3em]">Expenses</p>
          <p className="text-3xl font-bold text-foreground">${monthlySpend.toFixed(2)}</p>
        </div>
        <div className="ios-card p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-[.3em]">Savings</p>
          <p className="text-3xl font-bold text-success">${totalSaved.toFixed(2)}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="ios-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-warning" />
              <h2 className="text-lg font-semibold">Top Deals Near You</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Scroll deals left"
                onClick={() => scrollTopDeals('left')}
                className="h-8 w-8 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-secondary/80 transition"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="Scroll deals right"
                onClick={() => scrollTopDeals('right')}
                className="h-8 w-8 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-secondary/80 transition"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          {topDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No top deals available yet.</p>
          ) : (
            <div ref={topDealsRef} className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
              {topDeals.map((deal) => (
                <motion.div
                  key={deal.product}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                  className="ios-card min-w-[220px] flex-shrink-0 p-4"
                >
                  <div className="savings-badge mb-3">-{deal.savings}%</div>
                  <p className="text-sm font-semibold text-foreground leading-tight mb-1">{deal.product}</p>
                  <p className="text-xs text-muted-foreground mb-3">{deal.store}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-foreground">${deal.price.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground line-through">${deal.prevPrice.toFixed(2)}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="ios-card p-4">
            <div className="flex items-center gap-2 mb-4">
              <Receipt size={18} className="text-muted-foreground" />
              <h2 className="text-lg font-semibold">Recent Scans</h2>
            </div>
            {recentScans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No receipt scans found yet.</p>
            ) : (
              <div className="space-y-3">
                {recentScans.map((receipt) => (
                  <div key={receipt.id} className="ios-card p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                        <Receipt size={18} className="text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{receipt.storeName}</p>
                        <p className="text-xs text-muted-foreground">{receipt.date}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">${receipt.total.toFixed(2)}</p>
                      <span
                        className={`text-[10px] font-medium px-2 py-1 rounded-full ${
                          receipt.status === 'verified' ? 'bg-savings-light text-savings' : 'bg-warning/10 text-warning'
                        }`}
                      >
                        {receipt.status === 'verified' ? '✓ Verified' : '⏳ Processing'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ios-card p-4">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold">Transactions by Date</h2>
            </div>
            {dateWiseTransactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transaction history available for the last 30 days.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Tx</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Savings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dateWiseTransactions.slice(0, 5).map((row) => (
                    <TableRow key={row.date}>
                      <TableCell>{row.date}</TableCell>
                      <TableCell className="text-right">{row.transactions}</TableCell>
                      <TableCell className="text-right">${row.expenses.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-savings">${row.savings.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
