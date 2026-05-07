import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import BottomNav from "@/components/BottomNav";
import Header from "@/components/Header";
import PageTransition from "@/components/PageTransition";
import Dashboard from "@/pages/Dashboard";
import ScannerView from "@/pages/ScannerView";
import ShoppingList from "@/pages/ShoppingList";
import ComparisonScreen from "@/pages/ComparisonScreen";
import StoreMap from "@/pages/StoreMap";
import SettingsPage from "@/pages/SettingsPage";
import AuthPage from "@/pages/AuthPage";
import NotFound from "./pages/NotFound.tsx";
import { apiService } from "@/lib/api";

const queryClient = new QueryClient();

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
              <main id="main-content" tabIndex={-1}>
                <PageTransition>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/scanner" element={<ScannerView />} />
                    <Route path="/list" element={<ShoppingList />} />
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
