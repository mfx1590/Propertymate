import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet, clearTokens, loadTokens, setTokens } from './api';
import { registerPushToken, unregisterPushToken } from './push';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  signIn: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  me: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  refreshMe: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    if (!(await loadTokens())) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await apiGet<Me>('/users/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  /**
   * Registering the device belongs here rather than in a screen: the token is
   * per-account (the API upserts it against the caller), so it has to be
   * re-registered on every sign-in and dropped on sign-out — otherwise the
   * next person to use the phone inherits the last account's notifications.
   */
  useEffect(() => {
    if (me) void registerPushToken();
  }, [me]);

  const signIn = useCallback(
    async (tokens: { accessToken: string; refreshToken: string }) => {
      await setTokens(tokens);
      setLoading(true);
      await refreshMe();
    },
    [refreshMe],
  );

  const signOut = useCallback(async () => {
    await unregisterPushToken();
    await clearTokens();
    setMe(null);
  }, []);

  const value = useMemo(
    () => ({ me, loading, signIn, signOut, refreshMe }),
    [me, loading, signIn, signOut, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
