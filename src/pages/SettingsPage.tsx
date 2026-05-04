import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, MapPin, CreditCard, Bell, Shield, CircleHelp, LogOut, Store, KeyRound, Check, AlertCircle } from 'lucide-react';
import { apiService } from '@/lib/api';

const DEFAULT_ZIP_CODE = '90210';
const DEFAULT_SEARCH_RADIUS = 10;

function getStoredLocationSettings(): { zipCode: string; searchRadius: number } {
  try {
    const raw = globalThis.localStorage.getItem('smartCartSession');
    if (!raw) {
      return { zipCode: DEFAULT_ZIP_CODE, searchRadius: DEFAULT_SEARCH_RADIUS };
    }

    const parsed = JSON.parse(raw) as { zipCode?: string; searchRadius?: unknown };
    const parsedRadius = Number(parsed.searchRadius);

    return {
      zipCode: parsed.zipCode || DEFAULT_ZIP_CODE,
      searchRadius: Number.isFinite(parsedRadius) ? parsedRadius : DEFAULT_SEARCH_RADIUS,
    };
  } catch {
    return { zipCode: DEFAULT_ZIP_CODE, searchRadius: DEFAULT_SEARCH_RADIUS };
  }
}

const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`w-12 h-7 rounded-full transition-colors tap-highlight relative ${checked ? 'bg-success' : 'bg-border'}`}
  >
    <motion.div
      className="w-5 h-5 rounded-full bg-card shadow-sm absolute top-1"
      animate={{ left: checked ? 24 : 4 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    />
  </button>
);

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SaveIndicator = ({ state, errorMsg, successMsg }: { state: SaveState; errorMsg?: string; successMsg?: string }) => {
  if (state === 'saving') return <span className="text-[10px] text-muted-foreground">Saving…</span>;
  if (state === 'saved') return (
    <div className="flex items-center gap-1">
      <Check size={14} className="text-success" />
      {successMsg && <span className="text-[10px] text-success">{successMsg}</span>}
    </div>
  );
  if (state === 'error') return (
    <div className="flex items-center gap-1">
      <AlertCircle size={14} className="text-destructive" />
      {errorMsg && <span className="text-[10px] text-destructive">{errorMsg}</span>}
    </div>
  );
  return null;
};

const SettingsPage = () => {
  const navigate = useNavigate();
  const [zipCode, setZipCode] = useState(() => getStoredLocationSettings().zipCode);
  const [costcoMember, setCostcoMember] = useState(true);
  const [samsMember, setSamsMember] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [priceRadius, setPriceRadius] = useState(() => getStoredLocationSettings().searchRadius);

  const [pin, setPin] = useState('');
  const [pinSaveState, setPinSaveState] = useState<SaveState>('idle');
  const [pinError, setPinError] = useState('');
  const [pinSaveMessage, setPinSaveMessage] = useState('');

  const [preferredStore, setPreferredStore] = useState(() => {
    try {
      const raw = globalThis.localStorage.getItem('smartCartSession');
      if (raw) return (JSON.parse(raw) as { preferredStore?: string }).preferredStore ?? '';
    } catch { /* ignore */ }
    return '';
  });
  const [storeSaveState, setStoreSaveState] = useState<SaveState>('idle');
  const [storeSaveMessage, setStoreSaveMessage] = useState('');

  const handleSignOut = () => {
    apiService.clearToken();
    globalThis.localStorage.removeItem('smartCartSession');
    globalThis.localStorage.removeItem('smartCartUser');
    globalThis.location.href = '/auth';
  };

  const persistLocationSettings = (nextZipCode: string, nextRadius: number) => {
    try {
      const raw = globalThis.localStorage.getItem('smartCartSession');
      const session = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      session.zipCode = nextZipCode.trim();
      session.searchRadius = nextRadius;
      globalThis.localStorage.setItem('smartCartSession', JSON.stringify(session));
      globalThis.localStorage.setItem('smartCartUser', JSON.stringify(session));
    } catch {
      // ignore local persistence failures
    }
  };

  const handlePinBlur = async () => {
    if (!pin) return;
    if (!/^\d{4}$/.test(pin)) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }
    setPinError('');
    setPinSaveState('saving');
    setPinSaveMessage('');
    const result = await apiService.updateProfile({ pin });
    if (result.error) {
      setPinSaveState('error');
    } else {
      setPinSaveState('saved');
      setPinSaveMessage(result.data?.saveMode === 'fallback' ? 'Saved locally' : 'Synced');
      setPin('');
        setTimeout(() => navigate('/compare'), 1500);
    }
  };

  const handleStoreBlur = async () => {
    if (!preferredStore.trim()) return;
    setStoreSaveState('saving');
    setStoreSaveMessage('');
    const result = await apiService.updateProfile({ preferredStore });
    if (result.error) {
      setStoreSaveState('error');
    } else {
      try {
        const raw = globalThis.localStorage.getItem('smartCartSession');
        const session = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        session.preferredStore = preferredStore;
        globalThis.localStorage.setItem('smartCartSession', JSON.stringify(session));
      } catch { /* ignore */ }
      setStoreSaveState('saved');
      setStoreSaveMessage(result.data?.saveMode === 'fallback' ? 'Saved locally' : 'Synced');
        setTimeout(() => navigate('/compare'), 1500);
    }
  };

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-foreground mb-6 pt-2">Settings</h1>

      {/* Location */}
      <p className="section-title">Location</p>
      <div className="ios-card mb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin size={18} className="text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">ZIP Code</p>
              <p className="text-xs text-muted-foreground">For local prices & tax</p>
            </div>
          </div>
          <input
            value={zipCode}
            onChange={e => {
              const nextZipCode = e.target.value.replace(/\D/g, '').slice(0, 5);
              setZipCode(nextZipCode);
              persistLocationSettings(nextZipCode, priceRadius);
            }}
            className="w-20 h-8 rounded-lg bg-secondary text-center text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            maxLength={5}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">Search Radius</p>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={5}
              max={25}
              value={priceRadius}
              onChange={e => {
                const nextRadius = Number(e.target.value);
                setPriceRadius(nextRadius);
                persistLocationSettings(zipCode, nextRadius);
              }}
              className="w-24 accent-primary"
            />
            <span className="text-xs font-semibold text-foreground w-12 text-right">{priceRadius} mi</span>
          </div>
        </div>
      </div>

      {/* Account */}
      <p className="section-title">Account</p>
      <div className="ios-card mb-5 space-y-4">
        {/* Preferred Store */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Store size={18} className="text-primary flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Preferred Store</p>
              <p className="text-xs text-muted-foreground">Your go-to store</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <SaveIndicator state={storeSaveState} errorMsg="Save failed" successMsg={storeSaveMessage} />
            <input
              value={preferredStore}
              onChange={e => { setStoreSaveState('idle'); setStoreSaveMessage(''); setPreferredStore(e.target.value); }}
              onBlur={handleStoreBlur}
              placeholder="e.g. Walmart"
              className="w-28 h-8 rounded-lg bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Change PIN */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <KeyRound size={18} className="text-primary flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Change PIN</p>
              <p className="text-xs text-muted-foreground">Enter new 4-digit PIN</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <SaveIndicator state={pinSaveState} errorMsg={pinError || 'Save failed'} successMsg={pinSaveMessage} />
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                setPin(digits);
                setPinError('');
                setPinSaveState('idle');
                setPinSaveMessage('');
              }}
              onBlur={() => { void handlePinBlur(); }}
              placeholder="••••"
              maxLength={4}
              className="w-20 h-8 rounded-lg bg-secondary text-center text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 tracking-widest"
            />
          </div>
        </div>
        {pinError && (
          <p className="text-[10px] text-destructive pl-9">{pinError}</p>
        )}
      </div>

      <p className="section-title">Memberships</p>
      <div className="ios-card mb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard size={18} className="text-primary" />
            <p className="text-sm font-medium text-foreground">Costco Membership</p>
          </div>
          <Toggle checked={costcoMember} onChange={setCostcoMember} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard size={18} className="text-primary" />
            <p className="text-sm font-medium text-foreground">Sam's Club Membership</p>
          </div>
          <Toggle checked={samsMember} onChange={setSamsMember} />
        </div>
      </div>

      {/* Preferences */}
      <p className="section-title">Preferences</p>
      <div className="ios-card mb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell size={18} className="text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Price Alerts</p>
              <p className="text-xs text-muted-foreground">Notify when prices drop</p>
            </div>
          </div>
          <Toggle checked={notifications} onChange={setNotifications} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield size={18} className="text-primary" />
            <p className="text-sm font-medium text-foreground">Units</p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground bg-secondary px-3 py-1 rounded-full">Imperial (Lbs, Oz)</span>
        </div>
      </div>

      {/* About */}
      <p className="section-title">About</p>
      <div className="ios-card space-y-1">
        {[
          { label: 'Help & FAQ', icon: CircleHelp },
          { label: 'Privacy Policy', icon: Shield },
        ].map(({ label, icon: Icon }) => (
          <button key={label} className="flex items-center justify-between w-full py-3 tap-highlight">
            <div className="flex items-center gap-3">
              <Icon size={18} className="text-muted-foreground" />
              <p className="text-sm text-foreground">{label}</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        ))}
      </div>

      {/* Sign Out */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        onClick={handleSignOut}
        className="w-full h-12 rounded-xl bg-destructive/10 text-destructive font-semibold text-sm flex items-center justify-center gap-2 mt-6 tap-highlight active:scale-[0.97] transition-transform"
      >
        <LogOut size={18} />
        Sign Out
      </motion.button>

      <p className="text-center text-[10px] text-muted-foreground mt-6">SmartCart US v1.0 · Made with 🛒</p>
    </div>
  );
};

export default SettingsPage;
