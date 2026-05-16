import { Store, PriceObservation } from '@/types';

const API_BASE_URL = (() => {
  const configured = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configured) {
    const normalized = configured.replace(/\/$/, '');
    return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
  }

  if (import.meta.env.PROD) {
    console.warn(
      'VITE_API_BASE_URL is not configured. Frontend will try to use localhost, which will fail in production.'
    );
  }

  return 'http://localhost:5000/api';
})();

interface AuthResponse {
  token: string;
  user: {
    id: string;
    phoneNumber: string;
    email?: string;
    preferredStore?: string;
    zipCode?: string;
  };
}

type ProfileUpdateUser = AuthResponse['user'] & {
  saveMode?: 'remote' | 'fallback';
};

interface ApiResponse<T> {
  data?: T;
  error?: string;
  errorType?: 'network' | 'http';
}

interface PendingRegistration {
  phoneNumber: string;
  email: string;
  pin: string;
  preferredStore?: string;
  zipCode?: string;
  createdAt: string;
}

interface LocalFallbackUser {
  phoneNumber: string;
  email: string;
  pin: string;
  preferredStore?: string;
  zipCode?: string;
  registeredAt: string;
}

interface StorePayload {
  name: string;
  address: string;
  zipCode: string;
  lat: number;
  lng: number;
  chainId: string;
  logo?: string;
  isMembership?: boolean;
}

interface ReceiptPriceItemPayload {
  itemName: string;
  unitPrice: number;
}

type ProfileUpdateApiPayload = { user?: AuthResponse['user'] } | AuthResponse['user'];

type StoredSessionUser = AuthResponse['user'] & {
  pin?: string;
};

class ApiService {
  private token: string | null = null;
  private readonly pendingRegistrationsKey = 'smartCartPendingRegistrations';
  private readonly fallbackUsersKey = 'smartCartUsers';
  private isFlushingPendingRegistrations = false;

  constructor() {
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('online', () => {
        void this.flushPendingRegistrations();
      });
    }
  }

  initializePendingRegistrationSync() {
    void this.flushPendingRegistrations();
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  getToken(): string | null {
    return this.token || localStorage.getItem('authToken');
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('authToken');
  }

  private persistActiveUserSession(user: AuthResponse['user']) {
    const session: StoredSessionUser = {
      id: this.toSafeString(user.id),
      phoneNumber: this.normalizePhoneNumber(this.toSafeString(user.phoneNumber)),
      email: this.normalizeEmail(this.toSafeString(user.email)),
      preferredStore: this.toSafeString(user.preferredStore),
      zipCode: this.normalizeZipCode(user.zipCode),
    };

    localStorage.setItem('smartCartSession', JSON.stringify(session));
    localStorage.setItem('smartCartUser', JSON.stringify(session));
  }

  private syncStoredProfileFields(fields: { pin?: string; preferredStore?: string }, baseUser?: AuthResponse['user']) {
    try {
      const rawSession = localStorage.getItem('smartCartSession');
      const parsedSession = rawSession ? (JSON.parse(rawSession) as StoredSessionUser) : null;
      const sessionPhone = this.normalizePhoneNumber(
        this.toSafeString(baseUser?.phoneNumber ?? parsedSession?.phoneNumber)
      );

      const nextSession: StoredSessionUser = {
        id: this.toSafeString(baseUser?.id ?? parsedSession?.id),
        phoneNumber: sessionPhone,
        email: this.normalizeEmail(this.toSafeString(baseUser?.email ?? parsedSession?.email)),
        preferredStore: this.toSafeString(
          fields.preferredStore ?? baseUser?.preferredStore ?? parsedSession?.preferredStore
        ),
        zipCode: this.normalizeZipCode(baseUser?.zipCode ?? parsedSession?.zipCode),
        pin: fields.pin ?? parsedSession?.pin,
      };

      localStorage.setItem('smartCartSession', JSON.stringify(nextSession));
      localStorage.setItem('smartCartUser', JSON.stringify(nextSession));

      if (!sessionPhone) {
        return;
      }

      const users = this.getFallbackUsers();
      const idx = users.findIndex((entry) => this.normalizePhoneNumber(entry.phoneNumber) === sessionPhone);
      if (idx >= 0) {
        users[idx] = {
          ...users[idx],
          phoneNumber: sessionPhone,
          email: nextSession.email,
          preferredStore: fields.preferredStore ?? users[idx].preferredStore,
          pin: fields.pin ?? users[idx].pin,
          zipCode: nextSession.zipCode,
        };
        this.setFallbackUsers(users);
      }
    } catch {
      // Ignore local sync issues after successful remote updates.
    }
  }
  private getPendingRegistrations(): PendingRegistration[] {
    const raw = localStorage.getItem(this.pendingRegistrationsKey);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  private setPendingRegistrations(items: PendingRegistration[]) {
    localStorage.setItem(this.pendingRegistrationsKey, JSON.stringify(items));
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    const digitsOnly = [...phoneNumber].filter(char => /\d/.test(char)).join('');
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return digitsOnly.slice(1);
    }
    return digitsOnly;
  }

  private normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private normalizeZipCode(zipCode?: string): string {
    return String(zipCode || '').trim();
  }

  private isValidUSPhoneNumber(phoneNumber: string): boolean {
    return /^\d{10}$/.test(phoneNumber);
  }

  private isValidEmail(email: string): boolean {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
  }

  private isValidUSZipCode(zipCode: string): boolean {
    return /^\d{5}(?:-\d{4})?$/.test(zipCode);
  }

  private isValidPin(pin: string): boolean {
    return /^\d{4}$/.test(pin);
  }

  private getFallbackUsers(): LocalFallbackUser[] {
    const modernRaw = localStorage.getItem(this.fallbackUsersKey);
    if (modernRaw) {
      try {
        const parsed = JSON.parse(modernRaw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Ignore malformed storage and continue with migration path.
      }
    }

    // Backward compatibility with the old single-user key.
    const legacyRaw = localStorage.getItem('smartCartUser');
    if (!legacyRaw) {
      return [];
    }

    try {
      const legacyUser = JSON.parse(legacyRaw) as LocalFallbackUser;
      if (!legacyUser?.phoneNumber || !legacyUser?.pin) {
        return [];
      }

      const migrated = [legacyUser];
      localStorage.setItem(this.fallbackUsersKey, JSON.stringify(migrated));
      localStorage.removeItem('smartCartUser');
      return migrated;
    } catch {
      return [];
    }
  }

  private setFallbackUsers(users: LocalFallbackUser[]) {
    localStorage.setItem(this.fallbackUsersKey, JSON.stringify(users));
  }

  private upsertFallbackUser(user: LocalFallbackUser) {
    const normalizedPhone = this.normalizePhoneNumber(user.phoneNumber);
    const users = this.getFallbackUsers();
    const index = users.findIndex(entry => this.normalizePhoneNumber(entry.phoneNumber) === normalizedPhone);

    if (index >= 0) {
      users[index] = user;
    } else {
      users.push(user);
    }

    this.setFallbackUsers(users);
  }

  private enqueuePendingRegistration(item: PendingRegistration) {
    const queue = this.getPendingRegistrations();
    const exists = queue.some(entry => entry.phoneNumber === item.phoneNumber);
    if (exists) return;

    queue.push(item);
    this.setPendingRegistrations(queue);
  }

  private async flushPendingRegistrations() {
    if (this.isFlushingPendingRegistrations) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const queue = this.getPendingRegistrations();
    if (queue.length === 0) return;

    this.isFlushingPendingRegistrations = true;
    try {
      const remaining: PendingRegistration[] = [];

      for (const entry of queue) {
        const response = await this.request<AuthResponse>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            phoneNumber: entry.phoneNumber,
            email: entry.email,
            pin: entry.pin,
            preferredStore: entry.preferredStore,
            zipCode: entry.zipCode,
          }),
        });

        if (!response.error) {
          continue;
        }

        // Already-synced users should not block queue processing.
        if (response.errorType === 'http' && response.error.toLowerCase().includes('already registered')) {
          continue;
        }

        remaining.push(entry);

        // If network drops mid-flush, keep remaining entries for later retry.
        if (response.errorType === 'network') {
          const currentIndex = queue.indexOf(entry);
          const tail = queue.slice(currentIndex + 1);
          this.setPendingRegistrations([...remaining, ...tail]);
          return;
        }
      }

      this.setPendingRegistrations(remaining);
    } finally {
      this.isFlushingPendingRegistrations = false;
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.getToken()) {
      headers.Authorization = `Bearer ${this.getToken()}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Network error' }));
        return { error: errorData.message || `HTTP ${response.status}`, errorType: 'http' };
      }

      const data = await response.json();
      if (endpoint !== '/auth/register') {
        void this.flushPendingRegistrations();
      }
      return { data };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error', errorType: 'network' };
    }
  }

  // Auth methods
  async register(phoneNumber: string, pin: string, email: string, preferredStore?: string, zipCode?: string): Promise<ApiResponse<AuthResponse>> {
    if (!this.isValidPin(pin)) {
      return { error: 'PIN must be exactly 4 digits', errorType: 'http' };
    }

    const normalizedPhoneNumber = this.normalizePhoneNumber(phoneNumber);
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedZipCode = this.normalizeZipCode(zipCode);

    if (!this.isValidUSPhoneNumber(normalizedPhoneNumber)) {
      return { error: 'Phone number must be a valid US 10-digit number', errorType: 'http' };
    }

    if (!this.isValidEmail(normalizedEmail)) {
      return { error: 'Email must be valid', errorType: 'http' };
    }

    if (normalizedZipCode && !this.isValidUSZipCode(normalizedZipCode)) {
      return { error: 'ZIP code must be valid US format', errorType: 'http' };
    }

    const response = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        phoneNumber: normalizedPhoneNumber,
        email: normalizedEmail,
        pin,
        preferredStore,
        zipCode: normalizedZipCode,
      }),
    });
    if (!response.error) {
      void this.flushPendingRegistrations();
      return response;
    }

    // Respect backend responses; only fallback when request fails at network level.
    if (response.errorType !== 'network') {
      return response;
    }

    // Fallback to localStorage if backend is unavailable
    console.warn('Backend unavailable, using localStorage for registration');

    // LocalStorage fallback
    const users = this.getFallbackUsers();
    if (users.some(user => this.normalizePhoneNumber(user.phoneNumber) === normalizedPhoneNumber)) {
      return { error: 'Phone number already registered', errorType: 'http' };
    }

    if (users.some(user => this.normalizeEmail(user.email) === normalizedEmail)) {
      return { error: 'Email already registered', errorType: 'http' };
    }

    const userData = {
      phoneNumber: normalizedPhoneNumber,
      email: normalizedEmail,
      pin,
      preferredStore: preferredStore || '',
      zipCode: normalizedZipCode,
      registeredAt: new Date().toISOString(),
    };
    this.upsertFallbackUser(userData);
    this.enqueuePendingRegistration({
      phoneNumber: normalizedPhoneNumber,
      email: normalizedEmail,
      pin,
      preferredStore: preferredStore || '',
      zipCode: normalizedZipCode,
      createdAt: new Date().toISOString(),
    });
    const mockToken = 'local-' + Date.now();
    this.setToken(mockToken);
    return {
      data: {
        token: mockToken,
        user: {
          id: 'local-' + normalizedPhoneNumber,
          phoneNumber: normalizedPhoneNumber,
          email: normalizedEmail,
          preferredStore: preferredStore || '',
          zipCode: normalizedZipCode,
        },
      },
    };
  }

  async login(phoneNumber: string, pin: string): Promise<ApiResponse<AuthResponse>> {
    if (!this.isValidPin(pin)) {
      return { error: 'PIN must be exactly 4 digits', errorType: 'http' };
    }

    const normalizedPhoneNumber = this.normalizePhoneNumber(phoneNumber);
    if (!this.isValidUSPhoneNumber(normalizedPhoneNumber)) {
      return { error: 'Phone number must be a valid US 10-digit number', errorType: 'http' };
    }

    const response = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber: normalizedPhoneNumber, pin }),
    });
    console.log('Login response:', response);
    if (!response.error) {
      if (response.data?.token) {
        this.setToken(response.data.token);
      }
      if (response.data?.user) {
        this.persistActiveUserSession(response.data.user);
        this.syncStoredProfileFields({ pin }, response.data.user);
      }
      void this.flushPendingRegistrations();
      return response;
    }

    if (response.errorType !== 'network') {
      return response;
    }

    // Fallback to localStorage if backend is unavailable
    console.warn('Backend unavailable, using localStorage for login');

    // LocalStorage fallback
    const users = this.getFallbackUsers();
    console.log('Offline users count from localStorage:', users.length);
    if (users.length === 0) {
      return { error: 'Invalid credentials' };
    }

    const user = users.find(entry => this.normalizePhoneNumber(entry.phoneNumber) === normalizedPhoneNumber);
    if (!user) {
      return { error: 'Invalid credentials' };
    }

    console.log('Comparing normalized phone:', this.normalizePhoneNumber(user.phoneNumber), 'vs', normalizedPhoneNumber);
    console.log('Comparing pin:', user.pin, 'vs', pin);
    if (user.pin !== pin) {
      return { error: 'Invalid credentials' };
    }

    const mockToken = 'local-' + Date.now();
    const data = {
      data: {
        token: mockToken,
        user: {
          id: 'local-' + normalizedPhoneNumber,
          phoneNumber: normalizedPhoneNumber,
          email: user.email,
          preferredStore: user.preferredStore,
          zipCode: user.zipCode,
        },
      },
    };

    this.setToken(mockToken);
    this.persistActiveUserSession(data.data.user);
    return data;
  }

  private toSafeString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private toProfileUpdateUser(data: ProfileUpdateApiPayload, saveMode: 'remote' | 'fallback'): ProfileUpdateUser {
    const user = (data as { user?: AuthResponse['user'] }).user ?? (data as AuthResponse['user']);
    return { ...user, saveMode };
  }

  private async requestProfileUpdate(
    endpoint: string,
    fields: { pin?: string; preferredStore?: string }
  ): Promise<ApiResponse<ProfileUpdateUser>> {
    const response = await this.request<ProfileUpdateApiPayload>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });

    if (response.error || !response.data) {
      return { error: response.error, errorType: response.errorType };
    }

    return { data: this.toProfileUpdateUser(response.data, 'remote') };
  }

  private shouldTryLegacyProfileEndpoint(errorType?: 'network' | 'http', error?: string): boolean {
    return errorType === 'http' && /404|not found/i.test(error || '');
  }

  private canUseLocalProfileFallback(errorType?: 'network' | 'http', error?: string): boolean {
    if (errorType === 'network') return true;
    if (errorType !== 'http') return false;
    return /404|not found|401|unauthorized|invalid token|jwt/i.test(error || '');
  }

  private updateProfileInLocalFallback(
    fields: { pin?: string; preferredStore?: string },
    defaultError: ApiResponse<ProfileUpdateUser>
  ): ApiResponse<ProfileUpdateUser> {
    try {
      const rawSession = localStorage.getItem('smartCartSession');
      const session = rawSession ? (JSON.parse(rawSession) as Record<string, unknown>) : {};
      const sessionPhone = this.normalizePhoneNumber(this.toSafeString(session.phoneNumber));
      const users = this.getFallbackUsers();

      if (sessionPhone) {
        const idx = users.findIndex((entry) => this.normalizePhoneNumber(entry.phoneNumber) === sessionPhone);
        if (idx >= 0) {
          users[idx] = {
            ...users[idx],
            preferredStore: fields.preferredStore ?? users[idx].preferredStore,
            pin: fields.pin ?? users[idx].pin,
          };
          this.setFallbackUsers(users);
        }
      }

      if (fields.preferredStore !== undefined) {
        session.preferredStore = fields.preferredStore;
      }
      if (fields.pin !== undefined) {
        session.pin = fields.pin;
      }
      localStorage.setItem('smartCartSession', JSON.stringify(session));

      const fallbackUser: AuthResponse['user'] = {
        id: this.toSafeString(session.id),
        phoneNumber: this.toSafeString(session.phoneNumber),
        email: this.toSafeString(session.email),
        preferredStore: fields.preferredStore ?? this.toSafeString(session.preferredStore),
        zipCode: this.toSafeString(session.zipCode),
      };

      return { data: { ...fallbackUser, saveMode: 'fallback' } };
    } catch {
      return {
        error: defaultError.error || 'Failed to update profile',
        errorType: defaultError.errorType || 'network',
      };
    }
  }

  async updateProfile(fields: { pin?: string; preferredStore?: string }): Promise<ApiResponse<ProfileUpdateUser>> {
    if (fields.pin !== undefined && !/^\d{4}$/.test(fields.pin)) {
      return { error: 'PIN must be exactly 4 digits', errorType: 'http' };
    }
    const primary = await this.requestProfileUpdate('/auth/profile', fields);
    if (!primary.error) {
      if (primary.data) {
        this.persistActiveUserSession(primary.data);
        this.syncStoredProfileFields(fields, primary.data);
      }
      return primary;
    }

    if (this.shouldTryLegacyProfileEndpoint(primary.errorType, primary.error)) {
      const legacy = await this.requestProfileUpdate('/auth/update-profile', fields);
      if (!legacy.error) {
        if (legacy.data) {
          this.persistActiveUserSession(legacy.data);
          this.syncStoredProfileFields(fields, legacy.data);
        }
        return legacy;
      }
      if (legacy.errorType === 'http') return legacy;
    }

    if (!this.canUseLocalProfileFallback(primary.errorType, primary.error)) {
      return primary;
    }

    return this.updateProfileInLocalFallback(fields, primary);
  }

  // Store methods
  async getStores(): Promise<ApiResponse<Store[]>> {
    return this.request<Store[]>('/stores');
  }

  async searchStores(zip: string, name: string): Promise<ApiResponse<Store[]>> {
    return this.request<Store[]>(`/stores/search?zip=${encodeURIComponent(zip)}&name=${encodeURIComponent(name)}`);
  }

  async getStore(id: string): Promise<ApiResponse<Store>> {
    return this.request<Store>(`/stores/${id}`);
  }

  async createStore(store: StorePayload): Promise<ApiResponse<Store>> {
    return this.request<Store>('/stores', {
      method: 'POST',
      body: JSON.stringify(store),
    });
  }

  private buildItemId(itemName: string): string {
    const normalized = String(itemName || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    return normalized ? `item-${normalized}` : `item-${Date.now()}`;
  }

  private getCurrentUserId(): string {
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
  }

  async upsertReceiptItemsByStore(
    storeId: string,
    items: ReceiptPriceItemPayload[],
    receiptDate?: string | null,
  ): Promise<ApiResponse<{ updated: number; alreadyExists?: boolean }>> {
    const userId = this.getCurrentUserId();
    const existing = await this.getPrices();
    if (existing.error) {
      return { error: existing.error, errorType: existing.errorType };
    }

    const allPrices = existing.data || [];

    // Duplicate check: if any price record already has this store+date, the receipt was already saved
    if (receiptDate) {
      const isDuplicate = allPrices.some(
        (p) => p.receiptDate === receiptDate && p.prices?.[storeId] !== undefined,
      );
      if (isDuplicate) {
        return { data: { updated: 0, alreadyExists: true } };
      }
    }

    let updatedCount = 0;

    for (const item of items) {
      const itemName = String(item.itemName || '').trim();
      if (!itemName || item.unitPrice <= 0) continue;

      const itemId = this.buildItemId(itemName);
      const existingRecord = allPrices.find((p) => p.itemId === itemId);

      if (!existingRecord) {
        const createResult = await this.request<PriceObservation>('/prices', {
          method: 'POST',
          body: JSON.stringify({
            itemId,
            itemName,
            prices: { [storeId]: Number(item.unitPrice.toFixed(2)) },
            userId,
            receiptDate: receiptDate || null,
          }),
        });

        if (createResult.error) {
          return { error: createResult.error, errorType: createResult.errorType };
        }

        updatedCount += 1;
        continue;
      }

      const mergedPrices: Record<string, number> = {
        ...(existingRecord.prices ?? {}),
      };
      mergedPrices[storeId] = Number(item.unitPrice.toFixed(2));

      const updateResult = await this.request<PriceObservation>(`/prices/${existingRecord._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          itemId,
          itemName,
          prices: mergedPrices,
          userId: existingRecord.userId || userId,
          receiptDate: receiptDate || existingRecord.receiptDate || null,
        }),
      });

      if (updateResult.error) {
        return { error: updateResult.error, errorType: updateResult.errorType };
      }

      updatedCount += 1;
    }

    return { data: { updated: updatedCount } };
  }

  // Price methods
  async getPrices(userId?: string): Promise<ApiResponse<PriceObservation[]>> {
    const url = userId ? `/prices?userId=${encodeURIComponent(userId)}` : '/prices';
    return this.request<PriceObservation[]>(url);
  }

  async getPricesByStore(storeId: string): Promise<ApiResponse<PriceObservation[]>> {
    return this.request<PriceObservation[]>(`/prices/store/${storeId}`);
  }

  async createPrice(price: Omit<PriceObservation, '_id'>): Promise<ApiResponse<PriceObservation>> {
    return this.request<PriceObservation>('/prices', {
      method: 'POST',
      body: JSON.stringify(price),
    });
  }

  async updatePrice(id: string, price: Partial<PriceObservation>): Promise<ApiResponse<PriceObservation>> {
    return this.request<PriceObservation>(`/prices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(price),
    });
  }

  async deletePrice(id: string): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>(`/prices/${id}`, {
      method: 'DELETE',
    });
  }
}

export const apiService = new ApiService();
apiService.initializePendingRegistrationSync();