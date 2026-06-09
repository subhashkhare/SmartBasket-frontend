import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { apiService } from '@/lib/api';
import { Store as AppStore } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { getPostLoginDest, persistServerLastScan } from '@/lib/utils';

type LoginFormErrors = {
  phoneNumber?: string;
  pin?: string;
};

type OtpFormErrors = {
  otp?: string;
};

type RegisterFormErrors = {
  phoneNumber?: string;
  email?: string;
  pin?: string;
  zipCode?: string;
  preferredStore?: string;
};

const usPhoneRegex = /^(?:\+1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}$/;
const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const zipCodeRegex = /^\d{5}(?:-\d{4})?$/;
const pinRegex = /^\d{4}$/;
const sanitizePinValue = (value: string) => value.replace(/\D/g, '').slice(0, 4);

export default function AuthPage() {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [loginErrors, setLoginErrors] = useState<LoginFormErrors>({});
  const [registerErrors, setRegisterErrors] = useState<RegisterFormErrors>({});
  const [otpPhone, setOtpPhone] = useState<string | null>(null);
  const [otpErrors, setOtpErrors] = useState<OtpFormErrors>({});
  const showLoginPrompt = searchParams.get('next') === 'login';
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(showLoginPrompt);

  useEffect(() => {
    if (!showLoginPrompt) return;
    const t = setTimeout(() => setShowSuccessOverlay(false), 3500);
    return () => clearTimeout(t);
  }, [showLoginPrompt]);

  const [zipCodeValue, setZipCodeValue] = useState('');
  const [zipLocation, setZipLocation] = useState('');
  const [storeInput, setStoreInput] = useState('');
  const [selectedStore, setSelectedStore] = useState('');
  const [storeSuggestions, setStoreSuggestions] = useState<AppStore[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [storeSuggestionsLoading, setStoreSuggestionsLoading] = useState(false);

  useEffect(() => {
    if (!/^\d{5}$/.test(zipCodeValue)) {
      setZipLocation('');
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.zippopotam.us/us/${zipCodeValue}`);
        if (res.ok) {
          const data = await res.json();
          const place = data.places?.[0];
          if (place) setZipLocation(`${place['place name']}, ${place['state abbreviation']}`);
        } else {
          setZipLocation('');
        }
      } catch {
        setZipLocation('');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [zipCodeValue]);

  useEffect(() => {
    if (storeInput.length < 3 || !/^\d{5}$/.test(zipCodeValue)) {
      setStoreSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setStoreSuggestionsLoading(true);
      const response = await apiService.searchStores(zipCodeValue, storeInput);
      if (!response.error && response.data) {
        setStoreSuggestions(response.data);
        setShowSuggestions(true);
      } else {
        setStoreSuggestions([]);
        setShowSuggestions(storeInput.length >= 3);
      }
      setStoreSuggestionsLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [storeInput, zipCodeValue]);

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const phoneNumber = formData.get('phoneNumber') as string;
    const email = formData.get('email') as string;
    const pin = formData.get('pin') as string;

    const nextErrors: RegisterFormErrors = {};
    if (!usPhoneRegex.test(phoneNumber)) {
      nextErrors.phoneNumber = 'Enter a valid US phone number';
    }
    if (!emailRegex.test(String(email || '').trim())) {
      nextErrors.email = 'Enter a valid email address';
    }
    if (!pinRegex.test(pin)) {
      nextErrors.pin = 'PIN must be exactly 4 digits';
    }
    if (!zipCodeValue.trim()) {
      nextErrors.zipCode = 'ZIP code is required';
    } else if (!zipCodeRegex.test(zipCodeValue.trim())) {
      nextErrors.zipCode = 'ZIP must be 12345 or 12345-6789';
    }
    if (!selectedStore && !storeInput.trim()) {
      nextErrors.preferredStore = 'Please select a preferred store';
    }

    if (Object.keys(nextErrors).length > 0) {
      setRegisterErrors(nextErrors);
      setIsLoading(false);
      return;
    }

    setRegisterErrors({});

    const result = await apiService.register(phoneNumber, pin, email, selectedStore || storeInput, zipCodeValue);

    if (result.error) {
      toast.error(result.error);
    } else if (result.data) {
      apiService.clearToken();
      toast.success('Registration successful! Please log in.');
      globalThis.location.href = '/auth?next=login';
    }

    setIsLoading(false);
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const phoneNumber = formData.get('phoneNumber') as string;
    const pin = formData.get('pin') as string;

    const nextErrors: LoginFormErrors = {};
    if (!usPhoneRegex.test(phoneNumber)) {
      nextErrors.phoneNumber = 'Enter a valid US phone number';
    }
    if (!pinRegex.test(pin)) {
      nextErrors.pin = 'PIN must be exactly 4 digits';
    }

    if (Object.keys(nextErrors).length > 0) {
      setLoginErrors(nextErrors);
      setIsLoading(false);
      return;
    }

    setLoginErrors({});

    const result = await apiService.login(phoneNumber, pin);

    if (result.error) {
      toast.error(result.error);
    } else if (result.data) {
      if ('otpRequired' in result.data && result.data.otpRequired) {
        setOtpPhone(result.data.phoneNumber);
        toast.success('OTP sent to your WhatsApp. Enter it below.');
      } else if ('token' in result.data) {
        apiService.setToken(result.data.token);
        if (result.data.user?.lastScannedAt) {
          persistServerLastScan(phoneNumber, result.data.user.lastScannedAt);
        }
        toast.success('Login successful!');
        globalThis.location.href = getPostLoginDest(phoneNumber, result.data.user?.lastScannedAt);
      }
    }

    setIsLoading(false);
  };

  const handleVerifyOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const otp = (formData.get('otp') as string).trim();

    if (!/^\d{6}$/.test(otp)) {
      setOtpErrors({ otp: 'Enter the 6-digit code sent to your WhatsApp' });
      setIsLoading(false);
      return;
    }

    setOtpErrors({});

    const result = await apiService.verifyOtp(otpPhone!, otp);

    if (result.error) {
      toast.error(result.error);
    } else if (result.data) {
      if (result.data.user?.lastScannedAt) {
        persistServerLastScan(otpPhone!, result.data.user.lastScannedAt);
      }
      toast.success('Login successful!');
      globalThis.location.href = getPostLoginDest(otpPhone!, result.data.user?.lastScannedAt);
    }

    setIsLoading(false);
  };

  if (otpPhone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">Verify Your Identity</CardTitle>
            <CardDescription className="text-center">
              A 6-digit code was sent to your WhatsApp number ending in{' '}
              <span className="font-semibold text-foreground">
                ···{otpPhone.slice(-4)}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerifyOtp} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  autoComplete="one-time-code"
                  aria-invalid={!!otpErrors.otp}
                  onInput={e => {
                    e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
                    if (otpErrors.otp) setOtpErrors({});
                  }}
                  required
                />
                {otpErrors.otp && (
                  <p className="text-xs text-destructive">{otpErrors.otp}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Verifying...' : 'Verify & Login'}
              </Button>
              <button
                type="button"
                onClick={() => { setOtpPhone(null); setOtpErrors({}); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
              >
                ← Back to login
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">

      {/* Registration success overlay */}
      <AnimatePresence>
        {showSuccessOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
            onClick={() => setShowSuccessOverlay(false)}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center"
            >
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 size={36} className="text-green-600" />
                </div>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Registration Successful!</h2>
              <p className="text-sm text-gray-500 mb-6">
                Your account has been created. Log in with your phone number and PIN to continue.
              </p>
              <button
                onClick={() => setShowSuccessOverlay(false)}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm active:scale-[0.97] transition-transform"
              >
                Continue to Login
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">Smart Cart Saver</CardTitle>
          <CardDescription className="text-center">
            Save money on groceries with smart price comparison
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="login-phone">Phone Number</Label>
                  <Input
                    id="login-phone"
                    name="phoneNumber"
                    type="tel"
                    placeholder="Enter your phone number"
                    inputMode="tel"
                    pattern="^(?:\+1[ \.-]?)?(?:\(\d{3}\)|\d{3})[ \.-]?\d{3}[ \.-]?\d{4}$"
                    title="Enter a valid US phone number"
                    aria-invalid={!!loginErrors.phoneNumber}
                    onInput={() => {
                      if (loginErrors.phoneNumber) {
                        setLoginErrors(prev => ({ ...prev, phoneNumber: undefined }));
                      }
                    }}
                    required
                  />
                  {loginErrors.phoneNumber && (
                    <p className="text-xs text-destructive">{loginErrors.phoneNumber}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-pin">PIN</Label>
                  <Input
                    id="login-pin"
                    name="pin"
                    type="password"
                    placeholder="Enter your 4-digit PIN"
                    inputMode="numeric"
                    pattern="\\d{4}"
                    maxLength={4}
                    title="PIN must be exactly 4 digits"
                    aria-invalid={!!loginErrors.pin}
                    onInput={event => {
                      event.currentTarget.value = sanitizePinValue(event.currentTarget.value);
                      if (loginErrors.pin) {
                        setLoginErrors(prev => ({ ...prev, pin: undefined }));
                      }
                    }}
                    required
                  />
                  {loginErrors.pin && (
                    <p className="text-xs text-destructive">{loginErrors.pin}</p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Logging in...' : 'Login'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={handleRegister} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="register-phone">Phone Number</Label>
                  <Input
                    id="register-phone"
                    name="phoneNumber"
                    type="tel"
                    placeholder="Enter your phone number"
                    inputMode="tel"
                    pattern="^(?:\+1[ \.-]?)?(?:\(\d{3}\)|\d{3})[ \.-]?\d{3}[ \.-]?\d{4}$"
                    title="Enter a valid US phone number"
                    aria-invalid={!!registerErrors.phoneNumber}
                    onInput={() => {
                      if (registerErrors.phoneNumber) {
                        setRegisterErrors(prev => ({ ...prev, phoneNumber: undefined }));
                      }
                    }}
                    required
                  />
                  {registerErrors.phoneNumber && (
                    <p className="text-xs text-destructive">{registerErrors.phoneNumber}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
                    name="email"
                    type="email"
                    placeholder="Enter your email"
                    maxLength={254}
                    aria-invalid={!!registerErrors.email}
                    onInput={() => {
                      if (registerErrors.email) {
                        setRegisterErrors(prev => ({ ...prev, email: undefined }));
                      }
                    }}
                    required
                  />
                  {registerErrors.email && (
                    <p className="text-xs text-destructive">{registerErrors.email}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-pin">PIN</Label>
                  <Input
                    id="register-pin"
                    name="pin"
                    type="password"
                    placeholder="Create a 4-digit PIN"
                    inputMode="numeric"
                    pattern="\\d{4}"
                    maxLength={4}
                    title="PIN must be exactly 4 digits"
                    aria-invalid={!!registerErrors.pin}
                    onInput={event => {
                      event.currentTarget.value = sanitizePinValue(event.currentTarget.value);
                      if (registerErrors.pin) {
                        setRegisterErrors(prev => ({ ...prev, pin: undefined }));
                      }
                    }}
                    required
                  />
                  {registerErrors.pin && (
                    <p className="text-xs text-destructive">{registerErrors.pin}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP Code</Label>
                  <Input
                    id="zipCode"
                    name="zipCode"
                    placeholder="Enter your ZIP code"
                    inputMode="numeric"
                    pattern="^\d{5}(?:-\d{4})?$"
                    title="Enter a valid US ZIP code (12345 or 12345-6789)"
                    maxLength={10}
                    value={zipCodeValue}
                    aria-invalid={!!registerErrors.zipCode}
                    required
                    onChange={e => {
                      setZipCodeValue(e.target.value);
                      setStoreInput('');
                      setSelectedStore('');
                      setStoreSuggestions([]);
                      setShowSuggestions(false);
                      if (registerErrors.zipCode) {
                        setRegisterErrors(prev => ({ ...prev, zipCode: undefined }));
                      }
                    }}
                  />
                  {registerErrors.zipCode && (
                    <p className="text-xs text-destructive">{registerErrors.zipCode}</p>
                  )}
                  {zipLocation && !registerErrors.zipCode && (
                    <p className="text-xs text-gray-400">{zipLocation}</p>
                  )}
                </div>
                <div className="space-y-2 relative">
                  <Label htmlFor="preferredStore">Preferred Store</Label>
                  <Input
                    id="preferredStore"
                    placeholder={/^\d{5}$/.test(zipCodeValue) ? 'Type at least 3 characters...' : 'Enter ZIP code first'}
                    disabled={!/^\d{5}$/.test(zipCodeValue)}
                    value={storeInput}
                    autoComplete="off"
                    aria-invalid={!!registerErrors.preferredStore}
                    onChange={e => {
                      setStoreInput(e.target.value);
                      setSelectedStore('');
                      if (registerErrors.preferredStore) {
                        setRegisterErrors(prev => ({ ...prev, preferredStore: undefined }));
                      }
                    }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    onFocus={() => storeSuggestions.length > 0 && setShowSuggestions(true)}
                  />
                  {storeSuggestionsLoading && (
                    <p className="text-xs text-muted-foreground">Searching nearby stores...</p>
                  )}
                  {selectedStore && (
                    <p className="text-xs text-green-600">✓ {selectedStore}</p>
                  )}
                  {registerErrors.preferredStore && (
                    <p className="text-xs text-destructive">{registerErrors.preferredStore}</p>
                  )}
                  {showSuggestions && storeSuggestions.length === 0 && !storeSuggestionsLoading && (
                    <p className="text-xs text-muted-foreground">No stores found within 10 miles</p>
                  )}
                  {showSuggestions && storeSuggestions.length > 0 && (
                    <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                      {storeSuggestions.map(store => (
                        <li
                          key={store._id || store.id}
                          onMouseDown={() => {
                            setStoreInput(store.name);
                            setSelectedStore(store.name);
                            setShowSuggestions(false);
                          }}
                          className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-blue-50 border-b border-gray-100 last:border-0"
                        >
                          <div className="mt-0.5 shrink-0">
                            {store.logo && store.logo.startsWith('http') ? (
                              <img src={store.logo} alt="" className="w-8 h-8 rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <span className="text-xl">🏪</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-gray-900 truncate">{store.name}</div>
                            <div className="text-xs text-gray-500 truncate">{store.address}</div>
                          </div>
                          {store.distanceMiles != null && (
                            <div className="shrink-0 text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mt-0.5">
                              {store.distanceMiles} mi
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Registering...' : 'Register'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
