import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'kid';
  color: string;
  must_change_password: number;
  google_linked: number;
  password_login_disabled: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Demo login: the server creates a sandbox and a session, no password involved. */
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.get<User>('/auth/me'));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const me = await api.post<User>('/auth/login', { email, password });
    setUser(me);
  }, []);

  const loginDemo = useCallback(async () => {
    // document.referrer is the only trace of how the visitor found the
    // demo — the server keeps it in anonymous usage stats (demo mode only)
    const me = await api.post<User>('/auth/demo', { referrer: document.referrer || null });
    setUser(me);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        mustChangePassword: Boolean(user?.must_change_password),
        login,
        loginDemo,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth called outside AuthProvider');
  return ctx;
}

export { ApiError };
