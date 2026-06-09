import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import BottomNav from "@/components/BottomNav";
import Header from "@/components/Header";
import PageTransition from "@/components/PageTransition";
import Dashboard from "@/pages/Dashboard";
import ScannerView from "@/pages/ScannerView";
import ComparisonScreen from "@/pages/ComparisonScreen";
import StoreMap from "@/pages/StoreMap";
import SettingsPage from "@/pages/SettingsPage";
import AuthPage from "@/pages/AuthPage";
import NotFound from "./pages/NotFound.tsx";
import { apiService } from "@/lib/api";
import { getScanState } from "@/lib/utils";

const queryClient = new QueryClient();

// Blocks navigation away from /scanner when the user is in 'locked' state (>60 days since last scan).
// Stale users (15–60 days) land on /scanner after login but can freely navigate thereafter.
function ScanGuard() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/scanner') return;
    try {
      const s = localStorage.getItem('smartCartSession') || localStorage.getItem('smartCartUser');
      const phone = s ? (JSON.parse(s).phoneNumber || '') : '';
      if (getScanState(phone) === 'locked') {
        navigate('/scanner', { replace: true });
      }
    } catch { /* ignore */ }
  }, [navigate, location.pathname]);

  return null;
}

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user has a valid JWT token
    const token = apiService.getToken();
    setIsAuthenticated(!!token);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
            <div className="mx-auto flex max-w-[480px] items-center justify-between px-4 py-3">
              <a href="/" className="text-lg font-bold tracking-tight text-foreground">SmartCart</a>
              {isAuthenticated ? (
                <Header />
              ) : (
                <div className="w-10 h-10" />
              )}
            </div>
          </header>
          <a href="#main-content" className="skip-link">Skip to main content</a>
          {isAuthenticated ? (
            <div className="app-shell">
              <ScanGuard />
              <main id="main-content" tabIndex={-1}>
                <PageTransition>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/scanner" element={<ScannerView />} />
                    <Route path="/list" element={<Navigate to="/" replace />} />
                    <Route path="/compare" element={<ComparisonScreen />} />
                    <Route path="/map" element={<StoreMap />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/register" element={<Navigate to="/" replace />} />
                    <Route path="/auth" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </PageTransition>
              </main>
              <BottomNav />
            </div>
          ) : (
            <main id="main-content" tabIndex={-1}>
              <Routes>
                <Route path="/" element={<AuthPage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          )}
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
