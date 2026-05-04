export interface Product {
  id: string;
  upc: string;
  name: string;
  category: string;
  unitType: 'oz' | 'lb' | 'fl_oz' | 'gal' | 'each';
  unitSize: number;
  isTaxable: boolean;
}

export interface Store {
  _id: string;
  name: string;
  address: string;
  zipCode: string;
  location?: {
    type: string;
    coordinates: [number, number];
  };
  // Frontend compatibility
  id?: string;
  lat?: number;
  lng?: number;
  logo?: string;
  isMembership?: boolean;
  chainId?: string;
}

export interface PriceObservation {
  _id: string;
  itemName: string;
  itemId?: string;
  prices?: Record<string, number>;
  userId?: string;
  price?: number;
  store?: Store | string;
  observedAt?: string;
  // Frontend compatibility
  id?: string;
  productId?: string;
  storeId?: string;
  pricePerUnit?: number;
  unitType?: 'oz' | 'lb' | 'fl_oz';
  receiptId?: string;
}

export interface Receipt {
  id: string;
  userId: string;
  storeId: string;
  storeName: string;
  date: string;
  total: number;
  taxAmount: number;
  items: ReceiptItem[];
  imageUrl?: string;
  status: 'processing' | 'verified' | 'rejected';
}

export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  upc?: string;
  productId?: string;
}

export interface ShoppingListItem {
  id: string;
  name: string;
  sourceItemId?: string;
  quantity: number;
  checked: boolean;
  bestPrice?: number;
  bestStore?: string;
  savings?: number;
}

export interface StoreComparison {
  store: Store;
  totalCost: number;
  itemCount: number;
  savings: number;
  missingItems: string[];
}

export interface User {
  _id: string;
  phoneNumber: string;
  preferredStore?: string;
  zipCode?: string;
  // Frontend compatibility
  id?: string;
}
