import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, MapPin, CreditCard, Bell, Shield, CircleHelp, LogOut, Store, KeyRound, Check, AlertCircle } from 'lucide-react';
import { apiService } from '@/lib/api';
import { inferCityStateFromZip } from '@/lib/ocr';
import { getPreferredStoreName, setPreferredStoreName, getZipCode, setZipCode as persistZipToStorage } from '@/lib/utils';

const DEFAULT_ZIP_CODE = '90210';
const DEFAULT_SEARCH_RADIUS = 10;

function getStoredLocationSettings(): { zipCode: string; searchRadius: number } {
  const zipCode = getZipCode() || DEFAULT_ZIP_CODE;
  try {
    const raw = globalThis.localStorage.getItem('smartCartSession') || globalThis.localStorage.getItem('smartCartUser');
    if (raw) {
      const parsed = JSON.parse(raw) as { searchRadius?: unknown };
      const parsedRadius = Number(parsed.searchRadius);
      return { zipCode, searchRadius: Number.isFinite(parsedRadius) ? parsedRadius : DEFAULT_SEARCH_RADIUS };
    }
  } catch { /* ignore */ }
  return { zipCode, searchRadius: DEFAULT_SEARCH_RADIUS };
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

  const [zipSaveState, setZipSaveState] = useState<SaveState>('idle');
  const [zipError, setZipError] = useState('');
  const [zipLocation, setZipLocation] = useState('');

  const [preferredStore, setPreferredStore] = useState(() => getPreferredStoreName());
  const [storeSaveState, setStoreSaveState] = useState<SaveState>('idle');
  const [storeSaveMessage, setStoreSaveMessage] = useState('');
  const [storeErrorMsg, setStoreErrorMsg] = useState('');

  const handleSignOut = () => {
    apiService.clearToken();
    globalThis.localStorage.removeItem('smartCartSession');
    globalThis.localStorage.removeItem('smartCartUser');
    globalThis.location.href = '/auth';
  };

  const persistLocationSettings = (nextRadius: number) => {
    for (const key of ['smartCartSession', 'smartCartUser']) {
      try {
        const raw = globalThis.localStorage.getItem(key);
        if (!raw) continue;
        const session = JSON.parse(raw) as Record<string, unknown>;
        session.searchRadius = nextRadius;
        globalThis.localStorage.setItem(key, JSON.stringify(session));
      } catch { /* ignore */ }
    }
  };

  const handleZipBlur = async () => {
    if (!/^\d{5}$/.test(zipCode)) return;
    setZipSaveState('saving');
    setZipError('');
    setZipLocation('');

    const loc = await inferCityStateFromZip(zipCode);
    if (!loc || !loc.state) {
      setZipSaveState('error');
      setZipError('Zipcode not found');
      return;
    }

    setZipLocation(`${loc.city}, ${loc.state}`);
    setZipSaveState('saved');

    try {
      const oldZip = getZipCode();
      if (oldZip && oldZip !== zipCode) {
        sessionStorage.removeItem(`smartCartStateForZip_${oldZip}`);
      }
    } catch { /* ignore */ }
    persistZipToStorage(zipCode);
    setTimeout(() => navigate('/'), 1500);
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
    setStoreErrorMsg('');

    const storesResp = await apiService.getStores();
    const stores = storesResp.data || [];
    const lower = preferredStore.trim().toLowerCase();
    const found = stores.some((s) => {
      const sLower = (s.name || '').toLowerCase();
      return sLower === lower || sLower.includes(lower) || lower.includes(sLower);
    });

    if (!found) {
      setStoreSaveState('error');
      setStoreErrorMsg('Store data not available');
      return;
    }

    const result = await apiService.updateProfile({ preferredStore });
    if (result.error) {
      setStoreSaveState('error');
      setStoreErrorMsg('Save failed');
    } else {
      setPreferredStoreName(preferredStore);
      setStoreSaveState('saved');
      setStoreSaveMessage(result.data?.saveMode === 'fallback' ? 'Saved locally' : 'Synced');
      setTimeout(() => navigate('/'), 1500);
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
          <div className="flex items-center gap-2 flex-shrink-0">
            <SaveIndicator state={zipSaveState} errorMsg={zipError} />
            <input
              value={zipCode}
              onChange={e => {
                setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5));
                setZipSaveState('idle');
                setZipError('');
                setZipLocation('');
              }}
              onBlur={() => { void handleZipBlur(); }}
              className="w-20 h-8 rounded-lg bg-secondary text-center text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              maxLength={5}
            />
          </div>
        </div>
        {zipLocation && (
          <p className="text-xs text-success pl-9">{zipLocation}</p>
        )}
        {zipError && (
          <p className="text-xs text-destructive pl-9">{zipError}</p>
        )}
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
                persistLocationSettings(nextRadius);
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
            <SaveIndicator state={storeSaveState} errorMsg={storeErrorMsg} successMsg={storeSaveMessage} />
            <input
              value={preferredStore}
              onChange={e => { setStoreSaveState('idle'); setStoreSaveMessage(''); setStoreErrorMsg(''); setPreferredStore(e.target.value); }}
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
              placeholder="0000"
              autoComplete="off"
              maxLength={4}
              className="w-20 h-8 rounded-lg bg-secondary text-center text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 tracking-widest"
            />
          </div>
        </div>
        {pinError && (
          <p className="text-[10px] text-destructive pl-9">{pinError}</p>
        )}
      </div>

      {/* <p className="section-title">Memberships</p>
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
      </div> */}

      {/* Preferences */}
      {/* <p className="section-title">Preferences</p>
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
      </div> */}

      {/* About */}
      {/* <p className="section-title">About</p>
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
      </div> */}

      {/* Sign Out */}
      {/* <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        onClick={handleSignOut}
        className="w-full h-12 rounded-xl bg-destructive/10 text-destructive font-semibold text-sm flex items-center justify-center gap-2 mt-6 tap-highlight active:scale-[0.97] transition-transform"
      >
        <LogOut size={18} />
        Sign Out
      </motion.button> */}

      <p className="text-center text-[10px] text-muted-foreground mt-6">SmartCart US v1.0 · Made with 🛒</p>
    </div>
  );
};

export default SettingsPage;
