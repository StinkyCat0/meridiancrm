import {
  api,
  onSessionExpired,
  setAccessToken,
  type AcceptInviteInput,
  type LoginInput,
  type RegisterInput,
} from "@meridian/api-client";
import {
  atLeast,
  type AuthSession as Session,
  type MeResponse,
  type PublicUser,
  type Role,
  type WorkspaceSummary,
} from "@meridian/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { queryClient } from "./query";

interface AuthState {
  user: PublicUser | null;
  workspace: WorkspaceSummary | null;
  role: Role | null;
  me: MeResponse | null;
}

const initialState: AuthState = {
  user: null,
  workspace: null,
  role: null,
  me: null,
};

export interface AuthContextValue extends AuthState {
  loading: boolean;
  login: (input: LoginInput) => Promise<Session>;
  register: (input: RegisterInput) => Promise<Session>;
  acceptInvite: (input: AcceptInviteInput) => Promise<Session>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<MeResponse>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);
  const [loading, setLoading] = useState(true);
  const sessionVersion = useRef(0);

  const applyMe = useCallback((data: MeResponse) => {
    setState({
      user: data.user,
      workspace: data.workspace,
      role: data.role,
      me: data,
    });
    return data;
  }, []);

  const refreshMe = useCallback(async (): Promise<MeResponse> => applyMe(await api.auth.me()), [applyMe]);

  const establish = useCallback(
    async (session: Session): Promise<Session> => {
      sessionVersion.current += 1;
      setLoading(false);
      setState({
        user: session.user,
        workspace: session.workspace,
        role: session.role,
        me: null,
      });
      queryClient.clear();
      try {
        await refreshMe();
      } catch {
        // The session itself is valid; a failed profile read must not block sign-in.
      }
      return session;
    },
    [refreshMe],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const version = sessionVersion.current;
      try {
        await api.auth.refresh();
        const data = await api.auth.me();
        if (!cancelled && sessionVersion.current === version) applyMe(data);
      } catch {
        if (!cancelled && sessionVersion.current === version) {
          setAccessToken(null);
          setState(initialState);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyMe]);

  // A dead refresh cookie means every cached query is now unauthorized: drop
  // the session and the cache; ProtectedRoute then redirects to /login.
  useEffect(
    () =>
      onSessionExpired(() => {
        sessionVersion.current += 1;
        setState(initialState);
        queryClient.clear();
      }),
    [],
  );

  const login = useCallback(
    async (input: LoginInput) => establish(await api.auth.login(input)),
    [establish],
  );

  const register = useCallback(
    async (input: RegisterInput) => establish(await api.auth.register(input)),
    [establish],
  );

  const acceptInvite = useCallback(
    async (input: AcceptInviteInput) => establish(await api.auth.acceptInvite(input)),
    [establish],
  );

  const logout = useCallback(async () => {
    sessionVersion.current += 1;
    try {
      await api.auth.logout();
    } finally {
      setState(initialState);
      queryClient.clear();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      loading,
      login,
      register,
      acceptInvite,
      logout,
      refreshMe,
    }),
    [state, loading, login, register, acceptInvite, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

interface RequireRoleProps {
  minimum: Role;
  children: ReactNode;
  fallback?: ReactNode;
}

/** Renders children only when the signed-in member meets the minimum role. */
export function RequireRole({ minimum, children, fallback = null }: RequireRoleProps) {
  const { role, loading } = useAuth();
  if (loading) return null;
  if (!role || !atLeast(role, minimum)) return <>{fallback}</>;
  return <>{children}</>;
}
