import { Store, PriceObservation, Receipt, ShoppingListItem, StoreComparison } from '@/types';

export const mockStores: Store[] = [
  { id: '1', name: 'Walmart', address: '1234 Main St', zipCode: '90210', lat: 34.0901, lng: -118.4065, logo: '🏪', isMembership: false, chainId: 'walmart' },
  { id: '2', name: 'Target', address: '5678 Oak Ave', zipCode: '90210', lat: 34.0522, lng: -118.2437, logo: '🎯', isMembership: false, chainId: 'target' },
  { id: '3', name: 'Costco', address: '9101 Bulk Blvd', zipCode: '90210', lat: 34.0195, lng: -118.4912, logo: '📦', isMembership: true, chainId: 'costco' },
  { id: '4', name: 'Kroger', address: '2468 Fresh Ln', zipCode: '90210', lat: 34.0736, lng: -118.3997, logo: '🥕', isMembership: false, chainId: 'kroger' },
  { id: '5', name: "Sam's Club", address: '1357 Value Way', zipCode: '90210', lat: 34.0622, lng: -118.3521, logo: '🏬', isMembership: true, chainId: 'sams' },
];

export const mockRecentReceipts: Receipt[] = [
  { id: '1', userId: 'u1', storeId: '1', storeName: 'Walmart', date: '2026-03-29', total: 87.43, taxAmount: 4.12, items: [], status: 'verified' },
  { id: '2', userId: 'u1', storeId: '3', storeName: 'Costco', date: '2026-03-27', total: 214.67, taxAmount: 12.88, items: [], status: 'verified' },
  { id: '3', userId: 'u1', storeId: '2', storeName: 'Target', date: '2026-03-25', total: 52.19, taxAmount: 2.41, items: [], status: 'processing' },
];

export const mockShoppingList: ShoppingListItem[] = [
  { id: '1', name: 'Organic Whole Milk (1 gal)', quantity: 1, checked: false, bestPrice: 4.99, bestStore: 'Walmart', savings: 1.50 },
  { id: '2', name: 'Chicken Breast (2 lb)', quantity: 1, checked: false, bestPrice: 7.49, bestStore: 'Costco', savings: 2.30 },
  { id: '3', name: 'Bananas (1 bunch)', quantity: 1, checked: false, bestPrice: 0.59, bestStore: 'Kroger', savings: 0.20 },
  { id: '4', name: 'Cheddar Cheese (8 oz)', quantity: 2, checked: false, bestPrice: 3.29, bestStore: 'Walmart', savings: 0.70 },
  { id: '5', name: 'Whole Wheat Bread', quantity: 1, checked: true, bestPrice: 2.99, bestStore: 'Target', savings: 0.50 },
  { id: '6', name: 'Large Eggs (1 doz)', quantity: 1, checked: false, bestPrice: 3.19, bestStore: 'Kroger', savings: 0.80 },
];

export const mockComparisons: StoreComparison[] = [
  { store: mockStores[0], totalCost: 42.85, itemCount: 6, savings: 8.40, missingItems: [] },
  { store: mockStores[1], totalCost: 48.12, itemCount: 6, savings: 3.13, missingItems: [] },
  { store: mockStores[2], totalCost: 38.99, itemCount: 5, savings: 12.26, missingItems: ['Bananas (1 bunch)'] },
  { store: mockStores[3], totalCost: 45.20, itemCount: 6, savings: 6.05, missingItems: [] },
];

export const mockTopDeals = [
  { product: 'Organic Strawberries (1 lb)', store: 'Costco', price: 3.99, prevPrice: 5.99, savings: 33 },
  { product: 'Avocados (bag of 5)', store: 'Walmart', price: 2.98, prevPrice: 4.47, savings: 33 },
  { product: 'Greek Yogurt (32 oz)', store: 'Kroger', price: 4.49, prevPrice: 5.99, savings: 25 },
  { product: 'Atlantic Salmon (1 lb)', store: 'Costco', price: 8.99, prevPrice: 12.99, savings: 31 },
];

export const mockSpendingData = [
  { week: 'Mar 3', amount: 156 },
  { week: 'Mar 10', amount: 132 },
  { week: 'Mar 17', amount: 189 },
  { week: 'Mar 24', amount: 142 },
  { week: 'Mar 31', amount: 87 },
];

export const mockItemPrices = [
  {
    itemId: '1',
    itemName: 'Organic Whole Milk (1 gal)',
    prices: {
      'Walmart': 4.99,
      'Target': 5.49,
      'Costco': 4.79,
      'Kroger': 5.29,
    }
  },
  {
    itemId: '2',
    itemName: 'Chicken Breast (2 lb)',
    prices: {
      'Walmart': 8.99,
      'Target': 9.49,
      'Costco': 7.49,
      'Kroger': 8.79,
    }
  },
  {
    itemId: '3',
    itemName: 'Bananas (1 bunch)',
    prices: {
      'Walmart': 0.69,
      'Target': 0.79,
      'Costco': null, // missing
      'Kroger': 0.59,
    }
  },
  {
    itemId: '4',
    itemName: 'Cheddar Cheese (8 oz)',
    prices: {
      'Walmart': 3.29,
      'Target': 3.99,
      'Costco': 3.49,
      'Kroger': 3.69,
    }
  },
  {
    itemId: '5',
    itemName: 'Whole Wheat Bread',
    prices: {
      'Walmart': 3.49,
      'Target': 2.99,
      'Costco': 3.29,
      'Kroger': 3.19,
    }
  },
  {
    itemId: '6',
    itemName: 'Large Eggs (1 doz)',
    prices: {
      'Walmart': 3.99,
      'Target': 4.29,
      'Costco': 3.79,
      'Kroger': 3.19,
    }
  },
];
