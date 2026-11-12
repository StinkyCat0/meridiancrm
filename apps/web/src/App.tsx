import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { Skeleton } from "./components/ui/Skeleton";
import InvitePage from "./features/auth/InvitePage";
import LoginPage from "./features/auth/LoginPage";
import RegisterPage from "./features/auth/RegisterPage";
import { AuthProvider } from "./lib/auth";
import { queryClient } from "./lib/query";

const DashboardPage = lazy(() => import("./features/dashboard"));
const ContactsPage = lazy(() => import("./features/contacts"));
const CompaniesPage = lazy(() => import("./features/companies"));
const DealsPage = lazy(() => import("./features/deals"));
const ActivitiesPage = lazy(() => import("./features/activities"));
const SchedulePage = lazy(() => import("./features/schedule"));
const EstimatesPage = lazy(() => import("./features/estimates"));
const InvoicesPage = lazy(() => import("./features/invoices"));
const ServicesPage = lazy(() => import("./features/services"));
const SettingsPage = lazy(() => import("./features/settings"));
const DispatchPage = lazy(() => import("./features/dispatch"));
const CalendarPage = lazy(() => import("./features/calendar"));
const InboxPage = lazy(() => import("./features/inbox"));
const RevenuePage = lazy(() => import("./features/revenue"));
const AutomationsPage = lazy(() => import("./features/automations"));
const IntelligencePage = lazy(() => import("./features/intelligence"));
const TeamPage = lazy(() => import("./features/team"));
const WalkthroughPage = lazy(() => import("./features/walkthrough"));

function RouteFallback() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />

            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <LazyRoute>
                    <DashboardPage />
                  </LazyRoute>
                }
              />
              <Route
                path="contacts"
                element={
                  <LazyRoute>
                    <ContactsPage />
                  </LazyRoute>
                }
              />
              <Route
                path="contacts/*"
                element={
                  <LazyRoute>
                    <ContactsPage />
                  </LazyRoute>
                }
              />
              <Route
                path="companies"
                element={
                  <LazyRoute>
                    <CompaniesPage />
                  </LazyRoute>
                }
              />
              <Route
                path="companies/*"
                element={
                  <LazyRoute>
                    <CompaniesPage />
                  </LazyRoute>
                }
              />
              <Route
                path="deals"
                element={
                  <LazyRoute>
                    <DealsPage />
                  </LazyRoute>
                }
              />
              <Route
                path="schedule"
                element={
                  <LazyRoute>
                    <SchedulePage />
                  </LazyRoute>
                }
              />
              <Route
                path="estimates"
                element={
                  <LazyRoute>
                    <EstimatesPage />
                  </LazyRoute>
                }
              />
              <Route
                path="invoices"
                element={
                  <LazyRoute>
                    <InvoicesPage />
                  </LazyRoute>
                }
              />
              <Route
                path="services"
                element={
                  <LazyRoute>
                    <ServicesPage />
                  </LazyRoute>
                }
              />
              <Route
                path="activities"
                element={
                  <LazyRoute>
                    <ActivitiesPage />
                  </LazyRoute>
                }
              />
              <Route
                path="dispatch"
                element={
                  <LazyRoute>
                    <DispatchPage />
                  </LazyRoute>
                }
              />
              <Route
                path="calendar"
                element={
                  <LazyRoute>
                    <CalendarPage />
                  </LazyRoute>
                }
              />
              <Route
                path="inbox"
                element={
                  <LazyRoute>
                    <InboxPage />
                  </LazyRoute>
                }
              />
              <Route
                path="revenue"
                element={
                  <LazyRoute>
                    <RevenuePage />
                  </LazyRoute>
                }
              />
              <Route
                path="automations"
                element={
                  <LazyRoute>
                    <AutomationsPage />
                  </LazyRoute>
                }
              />
              <Route
                path="intelligence"
                element={
                  <LazyRoute>
                    <IntelligencePage />
                  </LazyRoute>
                }
              />
              <Route
                path="team"
                element={
                  <LazyRoute>
                    <TeamPage />
                  </LazyRoute>
                }
              />
              <Route
                path="walkthrough"
                element={
                  <LazyRoute>
                    <WalkthroughPage />
                  </LazyRoute>
                }
              />
              <Route
                path="settings"
                element={
                  <LazyRoute>
                    <SettingsPage />
                  </LazyRoute>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
          <Toaster richColors position="bottom-right" theme="dark" />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
