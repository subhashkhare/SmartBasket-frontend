import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingListItem } from '@/types';
import { apiService } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, MapPin, Trash2, ShoppingCart } from 'lucide-react';

const SHOPPING_LIST_SESSION_KEY = 'smartCartShoppingListSession';

type CatalogSuggestion = {
  id: string;
  name: string;
};

function createShoppingItemId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const ShoppingList = () => {
  const [items, setItems] = useState<ShoppingListItem[]>(() => getSessionShoppingList());
  const [newItem, setNewItem] = useState('');
  const [catalogSuggestions, setCatalogSuggestions] = useState<CatalogSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<CatalogSuggestion | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    globalThis.sessionStorage.setItem(SHOPPING_LIST_SESSION_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    const loadSuggestions = async () => {
      const pricesResp = await apiService.getPrices();
      const allPrices = pricesResp.data || [];
      const deduped = new Map<string, CatalogSuggestion>();

      allPrices.forEach((price) => {
        const normalizedName = price.itemName?.trim();
        if (!normalizedName) return;
        const mapKey = normalizedName.toLowerCase();
        if (!deduped.has(mapKey)) {
          deduped.set(mapKey, {
            id: price.itemId || price._id,
            name: normalizedName,
          });
        }
      });

      setCatalogSuggestions(Array.from(deduped.values()));
    };

    void loadSuggestions();
  }, []);

  const filteredSuggestions = useMemo(() => {
    const query = newItem.trim().toLowerCase();
    if (!query) return [] as CatalogSuggestion[];

    return catalogSuggestions
      .filter((entry) => entry.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [catalogSuggestions, newItem]);

  const toggleItem = (id: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, checked: !item.checked } : item
    ));
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const addItem = () => {
    const normalized = newItem.trim();
    if (!normalized) return;

    const normalizedLower = normalized.toLowerCase();
    const exactMatch = catalogSuggestions.find((entry) => entry.name.toLowerCase() === normalizedLower);
    const closestMatch = filteredSuggestions.find((entry) =>
      entry.name.toLowerCase().includes(normalizedLower)
    );
    const chosen =
      selectedSuggestion?.name.toLowerCase() === normalizedLower
        ? selectedSuggestion
        : exactMatch || closestMatch || null;

    setItems(prev => [...prev, {
      id: createShoppingItemId(),
      name: chosen?.name || normalized,
      sourceItemId: chosen?.id,
      quantity: 1,
      checked: false,
    }]);
    setNewItem('');
    setSelectedSuggestion(null);
    setShowSuggestions(false);
  };

  const applySuggestion = (suggestion: CatalogSuggestion) => {
    setNewItem(suggestion.name);
    setSelectedSuggestion(suggestion);
    setShowSuggestions(false);
  };

  const uncheckedItems = items.filter(i => !i.checked);
  const checkedItems = items.filter(i => i.checked);
  const totalSavings = items.reduce((sum, i) => sum + (i.savings || 0), 0);

  const goToComparison = () => {
    navigate('/compare');
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-1 pt-2">
        <h1 className="text-xl font-bold text-foreground">Shopping List</h1>
        <div className="savings-badge">
          Save ${totalSavings.toFixed(2)}
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {`${uncheckedItems.length} items remaining`}
      </p>

      {/* Add item */}
      <div className="flex gap-2 mb-5 items-start">
        <div className="flex-1 relative">
          <input
            value={newItem}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              globalThis.setTimeout(() => {
                setShowSuggestions(false);
              }, 100);
            }}
            onChange={e => {
              setNewItem(e.target.value);
              setShowSuggestions(true);
              if (selectedSuggestion && selectedSuggestion.name !== e.target.value) {
                setSelectedSuggestion(null);
              }
            }}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="Add item..."
            className="w-full h-11 rounded-xl bg-card border border-border px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />

          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
              {filteredSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(suggestion);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                >
                  {suggestion.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={addItem}
          className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center tap-highlight active:scale-[0.95] transition-transform"
        >
          <Plus size={20} className="text-primary-foreground" />
        </button>
      </div>

      {/* Unchecked items */}
      <div className="space-y-2 mb-6">
        <AnimatePresence>
          {uncheckedItems.map(item => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              className="ios-card flex items-center gap-3"
            >
              <button
                onClick={() => toggleItem(item.id)}
                className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center tap-highlight flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                {item.bestStore && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin size={10} className="text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">
                      Best at <span className="font-medium text-primary">{item.bestStore}</span>
                    </span>
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                {item.bestPrice ? (
                  <p className="text-sm font-semibold text-foreground">${item.bestPrice.toFixed(2)}</p>
                ) : null}
                {item.savings && item.savings > 0 ? (
                  <p className="text-[10px] text-savings font-medium">Save ${item.savings.toFixed(2)}</p>
                ) : null}
              </div>
              <button
                onClick={() => removeItem(item.id)}
                className="tap-highlight p-1"
              >
                <Trash2 size={14} className="text-muted-foreground" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Checked items */}
      {checkedItems.length > 0 && (
        <div>
          <p className="section-title">Completed</p>
          <div className="space-y-2">
            {checkedItems.map(item => (
              <motion.div
                key={item.id}
                layout
                className="ios-card flex items-center gap-3 opacity-50"
              >
                <button
                  onClick={() => toggleItem(item.id)}
                  className="w-6 h-6 rounded-full bg-success flex items-center justify-center tap-highlight flex-shrink-0"
                >
                  <Check size={14} className="text-success-foreground" />
                </button>
                <p className="text-sm text-foreground line-through flex-1">{item.name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Optimize button */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        onClick={goToComparison}
        className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 mt-6 tap-highlight active:scale-[0.97] transition-transform"
      >
        <ShoppingCart size={18} />
        Compare Prices
      </motion.button>
    </div>
  );
};

export default ShoppingList;

function getSessionShoppingList(): ShoppingListItem[] {
  try {
    const raw = globalThis.sessionStorage.getItem(SHOPPING_LIST_SESSION_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is ShoppingListItem => {
      return Boolean(item && typeof item.id === 'string' && typeof item.name === 'string');
    });
  } catch {
    return [];
  }
}
