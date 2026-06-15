import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiService } from '@/lib/api';

const Header = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [userData, setUserData] = useState<{ phoneNumber?: string; preferredStore?: string; zipCode?: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const raw = globalThis.localStorage.getItem('smartCartSession') || globalThis.localStorage.getItem('smartCartUser');
    if (raw) {
      try {
        setUserData(JSON.parse(raw));
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    const handleStore = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail.name;
      setUserData(prev => prev ? { ...prev, preferredStore: name } : prev);
    };
    const handleZip = (e: Event) => {
      const { zipCode } = (e as CustomEvent<{ zipCode: string }>).detail;
      setUserData(prev => prev ? { ...prev, zipCode } : prev);
    };
    globalThis.addEventListener('preferredStoreChanged', handleStore);
    globalThis.addEventListener('zipCodeChanged', handleZip);
    return () => {
      globalThis.removeEventListener('preferredStoreChanged', handleStore);
      globalThis.removeEventListener('zipCodeChanged', handleZip);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    firstMenuItemRef.current?.focus();
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  const handleSignOut = () => {
    // Clear authentication data
    apiService.clearToken();
    globalThis.localStorage.removeItem('smartCartSession');
    globalThis.localStorage.removeItem('smartCartUser');
    // Force auth check to re-run and land on login
    globalThis.location.href = '/auth';
  };

  const formatPhoneNumber = (phone: string): string => {
    if (!phone || phone.length < 10) return phone;
    const digitsOnly = [...phone].filter(char => /\d/.test(char)).join('');
    return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  };

  return (
    <div className="relative">
      <button
        ref={menuButtonRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="account-menu"
        className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center tap-highlight transition-colors hover:bg-primary/20"
      >
        <User size={20} aria-hidden="true" className="text-primary" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.2 }}
            id="account-menu"
            role="menu"
            aria-label="Account menu"
            className="absolute right-0 top-12 w-56 bg-card border border-border rounded-xl shadow-lg z-50"
          >
            {/* User Info */}
            {userData && (
              <div className="px-4 py-3 border-b border-border space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {formatPhoneNumber(userData.phoneNumber || '')}
                  </p>
                </div>
                {userData.preferredStore && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Preferred Store</p>
                    <p className="text-sm font-medium text-foreground truncate">{userData.preferredStore}</p>
                  </div>
                )}
                {userData.zipCode && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">ZIP Code</p>
                    <p className="text-sm font-medium text-foreground">{userData.zipCode}</p>
                  </div>
                )}
              </div>
            )}

            {/* Menu Items */}
            <div className="py-2">
              <Link
                ref={firstMenuItemRef}
                to="/settings"
                onClick={() => setIsOpen(false)}
                role="menuitem"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50 transition-colors"
              >
                <Settings size={16} aria-hidden="true" className="text-muted-foreground" />
                <span>Settings</span>
              </Link>

              <button
                onClick={handleSignOut}
                role="menuitem"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut size={16} aria-hidden="true" className="text-destructive" />
                <span>Sign Out</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Header;
