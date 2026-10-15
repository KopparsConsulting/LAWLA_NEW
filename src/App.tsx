import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { AppLayout } from "@/components/AppLayout";
import { ToastProvider } from "@/components/toast";
import { Spinner } from "@/components/ui";
import { AuthProvider, RequireAuth } from "@/features/auth/auth";
import LoginPage from "@/features/auth/LoginPage";

const InvestigationsPage = lazy(() => import("@/features/investigation/InvestigationsPage"));
const InvestigationPage = lazy(() => import("@/features/investigation/InvestigationPage"));
const DocumentsPage = lazy(() => import("@/features/documents/DocumentsPage"));
const DocumentPage = lazy(() => import("@/features/documents/DocumentPage"));
const AskPage = lazy(() => import("@/features/ask/AskPage"));
const NotFound = lazy(() => import("@/features/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  element={
                    <RequireAuth>
                      <AppLayout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<InvestigationsPage />} />
                  <Route path="utredning/:id" element={<InvestigationPage />} />
                  <Route path="utredning/:id/:step" element={<InvestigationPage />} />
                  <Route path="dokument" element={<DocumentsPage />} />
                  <Route path="dokument/:id" element={<DocumentPage />} />
                  <Route path="fraga" element={<AskPage />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
