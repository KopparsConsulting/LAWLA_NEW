import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { ApiError, authApi, setUnauthorizedHandler, systemApi } from "@/api/client";
import type { FeatureStatusDto, LoginRequest, RegisterRequest, UserDto } from "@/api/types";
import { Spinner } from "@/components/ui";

interface AuthState {
  user: UserDto | null;
  isLoading: boolean;
  login: (body: LoginRequest) => Promise<void>;
  /** Returnerar backendens meddelande om kontot väntar på godkännande. */
  register: (body: RegisterRequest) => Promise<string | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const ME_KEY = ["auth", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await authApi.me()).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(ME_KEY, null);
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const login = useCallback(
    async (body: LoginRequest) => {
      const res = await authApi.login(body);
      if (!res.user) throw new Error(res.message || "Inloggningen misslyckades.");
      qc.setQueryData(ME_KEY, res.user);
    },
    [qc],
  );

  const register = useCallback(
    async (body: RegisterRequest) => {
      const res = await authApi.register(body);
      if (res.user) qc.setQueryData(ME_KEY, res.user);
      return res.user ? null : res.message || "Kontot är skapat och väntar på godkännande.";
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {});
    qc.clear();
    qc.setQueryData(ME_KEY, null);
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({ user: me.data ?? null, isLoading: me.isLoading, login, register, logout }),
    [me.data, me.isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth måste användas inom AuthProvider");
  return ctx;
}

const FEATURE_DEFAULTS: FeatureStatusDto = {
  ai: { enabled: true, ragEnabled: true, embeddingsEnabled: true, analysisEnabled: true },
  elasticsearch: { enabled: false, contentIndexingEnabled: false },
  tts: { enabled: false },
  googleAuth: { enabled: false },
  security: { requireLogin: true, allowRegistrations: false, autoApproveRegistrations: false },
  documentAnalysisEnabled: false,
  documentManagementEnabled: false,
};

export function useFeatures(): FeatureStatusDto {
  const { data } = useQuery({ queryKey: ["features"], queryFn: systemApi.features, staleTime: 10 * 60_000, retry: 1 });
  return data ?? FEATURE_DEFAULTS;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
