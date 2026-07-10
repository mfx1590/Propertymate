'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, clearTokens, getAccessToken } from './api';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refreshMe: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState>({
  me: null,
  loading: true,
  refreshMe: async () => {},
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    if (!getAccessToken()) {
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

  const signOut = useCallback(() => {
    clearTokens();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, refreshMe, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
