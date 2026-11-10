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
const SettingsPage = lazy(() => import("./features/settings"));

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
                path="activities"
                element={
                  <LazyRoute>
                    <ActivitiesPage />
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
