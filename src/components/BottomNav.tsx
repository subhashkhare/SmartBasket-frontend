import { NavLink, useLocation } from 'react-router-dom';
import { Home, Camera, ShoppingCart, BarChart3, Settings } from 'lucide-react';
import { motion } from 'framer-motion';

const tabs = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/scanner', icon: Camera, label: 'Scan' },
  { to: '/list', icon: ShoppingCart, label: 'List' },
  { to: '/compare', icon: BarChart3, label: 'Compare' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const BottomNav = () => {
  const location = useLocation();

  return (
    <nav aria-label="Primary" className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-card/80 backdrop-blur-xl border-t border-border z-50 safe-area-bottom">
      <ul className="flex items-center justify-around h-16 px-2">
        {tabs.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to;
          return (
            <li key={to}>
              <NavLink
                to={to}
                aria-label={label}
                title={label}
                className="tap-highlight flex flex-col items-center gap-0.5 min-w-[56px] py-1"
              >
                <div className="relative">
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    aria-hidden="true"
                    className={isActive ? 'text-primary' : 'text-muted-foreground'}
                  />
                  {isActive && (
                    <motion.div
                      layoutId="tab-indicator"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                </div>
                <span className={`text-[10px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default BottomNav;
