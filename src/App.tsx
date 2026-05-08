import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationPanel } from "@/components/NotificationPanel";
import { AppLayout } from "@/layouts/AppLayout";
import { Pages } from "@/lib/lazyPages";

// Eager-load auth pages (small + first paint)
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import AdminLogin from "@/pages/AdminLogin";
import NotFound from "@/pages/NotFound";

const AgentDashboard = Pages["/agent/dashboard"].L;
const AgentConsole = Pages["/agent/console"].L;
const AgentSummary = Pages["/agent/summary"].L;
const AgentPayments = Pages["/agent/payments"].L;
const AgentProfile = Pages["/agent/profile"].L;
const AgentLeaderboard = Pages["/agent/leaderboard"].L;
const AgentInbox = Pages["/agent/inbox"].L;
const AgentHistory = Pages["/agent/history"].L;
const AgentRanges = Pages["/agent/ranges"].L;

const AdminDashboard = Pages["/admin/dashboard"].L;
const AdminAgents = Pages["/admin/agents"].L;
const AdminRateCard = Pages["/admin/rates"].L;
const AdminAllocation = Pages["/admin/allocation"].L;
const AdminCDR = Pages["/admin/cdr"].L;
const AdminNotifications = Pages["/admin/notifications"].L;
const AdminPayments = Pages["/admin/payments"].L;
const AdminSecurity = Pages["/admin/security"].L;
const AdminProviderRanges = Pages["/admin/provider-ranges"].L;
const AdminServices = Pages["/admin/services"].L;
const AdminWithdrawals = Pages["/admin/withdrawals"].L;
const AdminSettings = Pages["/admin/settings"].L;
const AdminBots = Pages["/admin/bots"].L;
const AdminIMSHealth = Pages["/admin/ims-health"].L;
const AdminSMSHadiHistory = Pages["/admin/smshadi-history"].L;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      // Stop all polling while the tab is hidden — huge perf win.
      refetchIntervalInBackground: false,
    },
  },
});

const PageFallback = () => (
  <div className="space-y-4 animate-in fade-in duration-150">
    <div className="h-9 w-56 rounded-md bg-white/[0.04]" />
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 rounded-xl bg-white/[0.03] border border-white/[0.04]" />
      ))}
    </div>
    <div className="h-64 rounded-xl bg-white/[0.03] border border-white/[0.04]" />
  </div>
);

const AuthPage = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen animate-in fade-in duration-200">{children}</div>
);

const AppRoutes = () => {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<AuthPage><Login /></AuthPage>} />
          <Route path="/register" element={<AuthPage><Register /></AuthPage>} />
          {/* Hidden admin entry — not linked from anywhere in the public UI */}
          <Route path="/sys/control-panel" element={<AuthPage><AdminLogin /></AuthPage>} />

          {/* Agent Routes */}
          <Route element={<AppLayout requiredRole="agent" />}>
            <Route path="/agent/dashboard" element={<AgentDashboard />} />
            <Route path="/agent/console" element={<AgentConsole />} />
            <Route path="/agent/history" element={<AgentHistory />} />
            {/* Legacy redirect — My Numbers is now merged into Get Number */}
            <Route path="/agent/my-numbers" element={<Navigate to="/agent/ranges" replace />} />
            <Route path="/agent/summary" element={<AgentSummary />} />
            <Route path="/agent/payments" element={<AgentPayments />} />
            <Route path="/agent/profile" element={<AgentProfile />} />
            <Route path="/agent/leaderboard" element={<AgentLeaderboard />} />
            <Route path="/agent/inbox" element={<AgentInbox />} />
            <Route path="/agent/ranges" element={<AgentRanges />} />
          </Route>

          {/* Admin Routes */}
          <Route element={<AppLayout requiredRole="admin" />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/agents" element={<AdminAgents />} />
            <Route path="/admin/rates" element={<AdminRateCard />} />
            <Route path="/admin/allocation" element={<AdminAllocation />} />
            <Route path="/admin/payments" element={<AdminPayments />} />
            <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
            <Route path="/admin/security" element={<AdminSecurity />} />
            <Route path="/admin/cdr" element={<AdminCDR />} />
            <Route path="/admin/provider-ranges" element={<AdminProviderRanges />} />
            <Route path="/admin/services" element={<AdminServices />} />
            <Route path="/admin/notifications" element={<AdminNotifications />} />
          <Route path="/admin/settings" element={<AdminSettings />} />
          <Route path="/admin/bots" element={<AdminBots />} />
          <Route path="/admin/ims-health" element={<AdminIMSHealth />} />
          <Route path="/admin/smshadi-history" element={<AdminSMSHadiHistory />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
    </Suspense>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <NotificationProvider>
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <AppRoutes />
            <NotificationPanel />
          </BrowserRouter>
        </NotificationProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
