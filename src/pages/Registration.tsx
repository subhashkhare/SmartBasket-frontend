import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, Eye, EyeOff } from 'lucide-react';
import { apiService } from '@/lib/api';
import { Store as AppStore } from '@/types';

type AuthMode = 'sign-in' | 'register';

interface UserData {
  phoneNumber: string;
  email: string;
  pin: string;
  zipCode: string;
  preferredStore: string;
}

const Registration = () => {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stores, setStores] = useState<AppStore[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<UserData>({
    phoneNumber: '',
    email: '',
    pin: '',
    zipCode: '',
    preferredStore: '',
  });

  // Check if user is already registered on mount
  useEffect(() => {
    // Default to register mode since we're here when not authenticated
    setMode('register');
  }, []);

  useEffect(() => {
    const loadStores = async () => {
      setStoresLoading(true);
      const response = await apiService.getStores();
      if (!response.error && response.data) {
        setStores(response.data);
        setFormData((prev) => ({
          ...prev,
          preferredStore: prev.preferredStore || response.data?.[0]?.name || '',
        }));
      }
      setStoresLoading(false);
    };

    void loadStores();
  }, []);

  const normalizeUSPhoneNumber = (phone: string): string => {
    const digitsOnly = [...phone].filter(char => /\d/.test(char)).join('');
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return digitsOnly.slice(1);
    }
    return digitsOnly;
  };

  const validatePhoneNumber = (phone: string) => {
    return /^\d{10}$/.test(normalizeUSPhoneNumber(phone));
  };

  const validateEmail = (email: string) => {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(email || '').trim());
  };

  const validatePin = (pin: string) => {
    return /^\d{4}$/.test(pin);
  };

  const validateZipCode = (zipCode: string) => {
    return /^\d{5}(?:-\d{4})?$/.test(zipCode);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!validatePhoneNumber(formData.phoneNumber)) {
      setError('Please enter a valid US phone number');
      return;
    }

    if (!validateEmail(formData.email)) {
      setError('Please enter a valid email address');
      return;
    }

    if (!validatePin(formData.pin)) {
      setError('PIN must be exactly 4 digits');
      return;
    }

    if (!validateZipCode(formData.zipCode)) {
      setError('Please enter a valid US ZIP code (12345 or 12345-6789)');
      return;
    }

    if (!formData.preferredStore) {
      setError('Please select a preferred store');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.register(
        normalizeUSPhoneNumber(formData.phoneNumber),
        formData.pin,
        String(formData.email || '').trim(),
        formData.preferredStore,
        formData.zipCode
      );

      if (response.error) {
        setError(response.error);
        return;
      }

      if (response.data) {
        apiService.setToken(response.data.token);
        // Reload page to trigger auth check in App.tsx
        globalThis.location.href = '/';
      }
    } catch (err: unknown) {
      console.error(err);
      setError('Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validatePhoneNumber(formData.phoneNumber)) {
      setError('Please enter a valid phone number');
      return;
    }

    if (!validatePin(formData.pin)) {
      setError('PIN is required');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.login(
        extractPhoneDigits(formData.phoneNumber),
        formData.pin
      );

      if (response.error) {
        setError(response.error);
        return;
      }

      if (response.data) {
        apiService.setToken(response.data.token);
        // Reload page to trigger auth check in App.tsx
        globalThis.location.href = '/';
      }
    } catch (err: unknown) {
      console.error(err);
      setError('Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <ShoppingCart size={32} className="text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Smart Cart Saver</h1>
          <p className="text-sm text-muted-foreground">Save on groceries with smart shopping</p>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-6 bg-secondary p-1 rounded-xl">
          <button
            onClick={() => {
              setMode('sign-in');
              setError(null);
              setFormData(prev => ({ ...prev, pin: '', phoneNumber: '' }));
            }}
            className={`flex-1 h-10 rounded-lg text-sm font-semibold transition-all ${
              mode === 'sign-in'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              setMode('register');
              setError(null);
              setFormData(prev => ({ ...prev, pin: '', phoneNumber: '' }));
            }}
            className={`flex-1 h-10 rounded-lg text-sm font-semibold transition-all ${
              mode === 'register'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Register
          </button>
        </div>

        {/* Form */}
        <motion.form
          key={mode}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          onSubmit={mode === 'register' ? handleRegister : handleSignIn}
          className="space-y-4"
        >
          {/* Phone Number */}
          <div>
            <label htmlFor="phoneNumber" className="block text-sm font-medium text-foreground mb-2">
              Phone Number
            </label>
            <input
              id="phoneNumber"
              type="tel"
              name="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleInputChange}
              placeholder="(555) 123-4567"
              className="w-full h-11 rounded-xl bg-card border border-border px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Email (only for registration) */}
          {mode === 'register' && (
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="you@example.com"
                className="w-full h-11 rounded-xl bg-card border border-border px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          {/* ZIP Code (only for registration) */}
          {mode === 'register' && (
            <div>
              <label htmlFor="zipCode" className="block text-sm font-medium text-foreground mb-2">
                ZIP Code
              </label>
              <input
                id="zipCode"
                type="text"
                name="zipCode"
                value={formData.zipCode}
                onChange={handleInputChange}
                placeholder="90210"
                maxLength={5}
                className="w-full h-11 rounded-xl bg-card border border-border px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Must be 5 digits</p>
            </div>
          )}

          {/* PIN/ZIP */}
          <div>
            <label htmlFor="pin" className="block text-sm font-medium text-foreground mb-2">
              {mode === 'register' ? 'Create PIN' : 'PIN'}
            </label>
            <div className="relative">
              <input
                id="pin"
                type={showPin ? 'text' : 'password'}
                name="pin"
                value={formData.pin}
                onChange={handleInputChange}
                placeholder={mode === 'register' ? 'Create a 4-digit PIN' : 'Enter your PIN'}
                className="w-full h-11 rounded-xl bg-card border border-border px-4 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {mode === 'register' && (
              <p className="text-[10px] text-muted-foreground mt-1">Must be exactly 4 digits</p>
            )}
          </div>

          {/* Preferred Store (only for registration) */}
          {mode === 'register' && (
            <div>
              <label htmlFor="preferredStore" className="block text-sm font-medium text-foreground mb-2">
                Preferred Store
              </label>
              <select
                id="preferredStore"
                name="preferredStore"
                value={formData.preferredStore}
                onChange={handleInputChange}
                disabled={storesLoading || stores.length === 0}
                className="w-full h-11 rounded-xl bg-card border border-border px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {stores.length > 0 ? stores.map(store => (
                  <option key={store._id || store.id} value={store.name}>
                    {store.logo || '🏪'} {store.name}
                  </option>
                )) : (
                  <option value="">{storesLoading ? 'Loading stores...' : 'No stores found'}</option>
                )}
              </select>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm"
            >
              {error}
            </motion.div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 tap-highlight active:scale-[0.97] transition-transform disabled:opacity-70 disabled:cursor-not-allowed mt-6"
          >
            {loading ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full"
                />
                {mode === 'register' ? 'Registering...' : 'Signing In...'}
              </>
            ) : (
              <>{mode === 'register' ? 'Create Account' : 'Sign In'}</>
            )}
          </button>
        </motion.form>

        {/* Footer text */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          {mode === 'register'
            ? 'Already have an account? Click "Sign In" above'
            : "Don't have an account? Click \"Register\" above"}
        </p>
      </motion.div>
    </div>
  );
};

export default Registration;
