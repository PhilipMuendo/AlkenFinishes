import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getRefreshToken, setLogoutHandler, setTokens } from './api';
import type { AuthUser } from './types';

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLogoutHandler(() => setUser(null));
    api<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: AuthUser }>(
      '/auth/login',
      { body: { email, password } },
    );
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    await api('/auth/logout', { body: { refreshToken } }).catch(() => undefined);
    setTokens(null, null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
