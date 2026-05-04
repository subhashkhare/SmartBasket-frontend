import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingDown, Receipt, ChevronLeft, ChevronRight, Sparkles, ArrowDownRight } from 'lucide-react';
import Header from '@/components/Header';
import { apiService } from '@/lib/api';
import { PriceObservation, Store } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type WeeklySpend = { week: string; amount: number };
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

const getUserReceiptHistory = (userKey: string): ReceiptHistoryEntry[] => {
  try {
    const data = localStorage.getItem(RECEIPT_HISTORY_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry: any) => entry.userKey === userKey && entry.date && typeof entry.total === 'number'
    );
  } catch {
    return [];
  }
};

const Dashboard = () => {
  const [stores, setStores] = useState<Store[]>([]);
  const [prices, setPrices] = useState<PriceObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const topDealsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const [storesResp, pricesResp] = await Promise.all([apiService.getStores(), apiService.getPrices()]);

      if (storesResp.error) setError(storesResp.error);
      if (pricesResp.error) setError(pricesResp.error);
      if (storesResp.data) setStores(storesResp.data);
      if (pricesResp.data) setPrices(pricesResp.data);

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
    return Number(userReceipts
      .filter((entry) => toDateTimestamp(entry.date) >= cutoff)
      .reduce((sum, entry) => sum + entry.total, 0)
      .toFixed(2));
  }, [userReceipts]);

  const totalSaved = useMemo(() => {
    const cutoff = Date.now() - ONE_MONTH_MS;
    return Number(userReceipts
      .filter((entry) => toDateTimestamp(entry.date) >= cutoff)
      .reduce((sum, entry) => sum + (entry.savings || 0), 0)
      .toFixed(2));
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

  if (error) {
    return <div className="page-container py-8 text-sm text-destructive">Failed to load dashboard data: {error}</div>;
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pt-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">SmartCart</h1>
          <p className="text-sm text-muted-foreground">{locationLabel}</p>
        </div>
        <Header />
      </div>

      {/* Savings Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className="ios-card mb-4 bg-gradient-to-br from-success/10 to-success/5 border border-success/20"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
            <TrendingDown size={20} className="text-success" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Saved This Month</p>
            <p className="text-2xl font-bold text-success">${totalSaved.toFixed(2)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowDownRight size={12} className="text-success" />
          <span>Best-known basket spend · ${monthlySpend.toFixed(2)} total</span>
        </div>
      </motion.div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="ios-card py-3 px-3">
          <p className="text-[10px] text-muted-foreground">1-Month Transactions</p>
          <p className="text-base font-bold text-foreground">{monthlyTransactions}</p>
        </div>
        <div className="ios-card py-3 px-3">
          <p className="text-[10px] text-muted-foreground">Total Expenses</p>
          <p className="text-base font-bold text-foreground">${monthlySpend.toFixed(2)}</p>
        </div>
        <div className="ios-card py-3 px-3">
          <p className="text-[10px] text-muted-foreground">Monthly Savings</p>
          <p className="text-base font-bold text-success">${totalSaved.toFixed(2)}</p>
        </div>
      </div>

      <div className="ios-card mb-4">
        <p className="section-title mb-2">Date-wise Transactions (Last 30 Days)</p>
        {dateWiseTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No transactions available for the last 30 days.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">Date</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Savings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dateWiseTransactions.map((row) => (
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

      {/* Top Deals */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-warning" />
            <p className="section-title mb-0">Top Deals Near You</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Scroll deals left"
              onClick={() => scrollTopDeals('left')}
              className="h-7 w-7 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-secondary/80 transition"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              aria-label="Scroll deals right"
              onClick={() => scrollTopDeals('right')}
              className="h-7 w-7 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-secondary/80 transition"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div ref={topDealsRef} className="flex gap-3 overflow-x-hidden pb-2 -mx-4 px-4">
          {topDeals.map((deal, i) => (
            <motion.div
              key={deal.product}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.08 }}
              className="ios-card min-w-[200px] flex-shrink-0"
            >
              <div className="savings-badge mb-2">-{deal.savings}%</div>
              <p className="text-sm font-semibold text-foreground leading-tight mb-1">{deal.product}</p>
              <p className="text-xs text-muted-foreground mb-2">{deal.store}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-foreground">${deal.price}</span>
                <span className="text-xs text-muted-foreground line-through">${deal.prevPrice}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Recent Scans */}
      <div>
        <p className="section-title">Recent Scans</p>
        <div className="space-y-2">
          {recentScans.map((receipt, i) => (
            <motion.div
              key={receipt.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              className="ios-card flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <Receipt size={18} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{receipt.storeName}</p>
                <p className="text-xs text-muted-foreground">{receipt.date}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-foreground">${receipt.total.toFixed(2)}</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                  receipt.status === 'verified' ? 'bg-savings-light text-savings' : 'bg-warning/10 text-warning'
                }`}>
                  {receipt.status === 'verified' ? '✓ Verified' : '⏳ Processing'}
                </span>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
