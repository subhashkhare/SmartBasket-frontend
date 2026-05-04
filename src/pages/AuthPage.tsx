import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiService } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

type LoginFormErrors = {
  phoneNumber?: string;
  pin?: string;
};

type RegisterFormErrors = {
  phoneNumber?: string;
  email?: string;
  pin?: string;
  zipCode?: string;
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
  const showLoginPrompt = searchParams.get('next') === 'login';

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const phoneNumber = formData.get('phoneNumber') as string;
    const email = formData.get('email') as string;
    const pin = formData.get('pin') as string;
    const preferredStore = formData.get('preferredStore') as string;
    const zipCode = formData.get('zipCode') as string;

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
    if (zipCode && !zipCodeRegex.test(zipCode.trim())) {
      nextErrors.zipCode = 'ZIP must be 12345 or 12345-6789';
    }

    if (Object.keys(nextErrors).length > 0) {
      setRegisterErrors(nextErrors);
      setIsLoading(false);
      return;
    }

    setRegisterErrors({});

    const result = await apiService.register(phoneNumber, pin, email, preferredStore, zipCode);

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
      apiService.setToken(result.data.token);
      toast.success('Login successful!');
      globalThis.location.href = '/';
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">Smart Cart Saver</CardTitle>
          <CardDescription className="text-center">
            Save money on groceries with smart price comparison
          </CardDescription>
          {showLoginPrompt && (
            <p className="text-center text-sm text-primary font-medium">
              Registration complete. Log in using your phone number and PIN.
            </p>
          )}
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
                    pattern="^(?:\\+1[\\s.-]?)?(?:\\(\\d{3}\\)|\\d{3})[\\s.-]?\\d{3}[\\s.-]?\\d{4}$"
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
                    pattern="^(?:\\+1[\\s.-]?)?(?:\\(\\d{3}\\)|\\d{3})[\\s.-]?\\d{3}[\\s.-]?\\d{4}$"
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
                  <Label htmlFor="preferredStore">Preferred Store (Optional)</Label>
                  <Input
                    id="preferredStore"
                    name="preferredStore"
                    placeholder="e.g., Walmart, Target"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP Code (Optional)</Label>
                  <Input
                    id="zipCode"
                    name="zipCode"
                    placeholder="Enter your ZIP code"
                    inputMode="numeric"
                    pattern="^\\d{5}(?:-\\d{4})?$"
                    title="Enter a valid US ZIP code (12345 or 12345-6789)"
                    maxLength={10}
                    aria-invalid={!!registerErrors.zipCode}
                    onInput={() => {
                      if (registerErrors.zipCode) {
                        setRegisterErrors(prev => ({ ...prev, zipCode: undefined }));
                      }
                    }}
                  />
                  {registerErrors.zipCode && (
                    <p className="text-xs text-destructive">{registerErrors.zipCode}</p>
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