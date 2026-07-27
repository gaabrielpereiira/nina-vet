import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ChatInterface from './components/ChatInterface';
import Contacts from './components/Contacts';
import Settings from './components/Settings';
import Team from './components/Team';
import Scheduling from './components/Scheduling';
import Kanban from './components/Kanban';
import Auth from './pages/Auth';
import ProtectedRoute from './components/ProtectedRoute';

import { CompanySettingsProvider } from './hooks/useCompanySettings';
import { AuthProvider } from './hooks/useAuth';
import { Toaster } from 'sonner';
import { OnboardingWizard } from './components/OnboardingWizard';
import { useOnboardingStatus } from './hooks/useOnboardingStatus';

// Componente de Layout que envolve a aplicação principal
const AppLayout: React.FC = () => {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { isComplete, hasSeenWizard, loading } = useOnboardingStatus();

  // Show wizard automatically on first load if not complete and never seen
  useEffect(() => {
    if (!loading && !isComplete && !hasSeenWizard) {
      setShowOnboarding(true);
    }
  }, [loading, isComplete, hasSeenWizard]);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[128px] pointer-events-none -translate-x-1/2 -translate-y-1/2 z-0"></div>
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-accent/10 rounded-full blur-[128px] pointer-events-none translate-x-1/2 translate-y-1/2 z-0"></div>
      
      <Sidebar />
      
      <main className="flex-1 h-full overflow-hidden relative z-10 flex flex-col">
        {/* Top Border Gradient */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-50 z-20"></div>
        
        <div className="flex-1 w-full h-full relative">
          <Outlet context={{ showOnboarding, setShowOnboarding }} />
        </div>
      </main>

      <OnboardingWizard 
        isOpen={showOnboarding} 
        onClose={() => setShowOnboarding(false)} 
      />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <CompanySettingsProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route path="/auth" element={<Auth />} />
            
            {/* Protected Routes (With Sidebar) */}
            <Route element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/pipeline" element={<Kanban />} />
              <Route path="/chat" element={<ChatInterface />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/scheduling" element={<Scheduling />} />
              <Route path="/team" element={<Team />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            
            {/* Catch all - redirect to dashboard */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster 
          position="top-right"
          richColors
          theme="dark"
        />
      </CompanySettingsProvider>
    </AuthProvider>
  );
};

export default App;
