import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_BASE } from './config';

/**
 * API client, mirroring apps/web/src/lib/api.ts including its single-flight
 * refresh — the API rotates refresh tokens and treats a reused one as theft
 * (§2.4), so two concurrent 401s must not both spend the same token.
 *
 * Storage differs from web on purpose: SecureStore puts the tokens in the
 * Keychain / Android Keystore rather than anything world-readable. SecureStore
 * has no web implementation, so the web preview falls back to localStorage —
 * that path is for development only and never ships to a device.
 */
const ACCESS_KEY = 'pv.accessToken';
const REFRESH_KEY = 'pv.refreshToken';

const isWeb = Platform.OS === 'web';

async function readItem(key: string): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}
async function writeItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/**
 * Reading from the Keychain is async, but every request needs the token, so
 * it is mirrored here after the first load and kept in step on write.
 */
let accessToken: string | null = null;
let loaded = false;

export async function loadTokens(): Promise<string | null> {
  if (!loaded) {
    accessToken = await readItem(ACCESS_KEY);
    loaded = true;
  }
  return accessToken;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function setTokens(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  loaded = true;
  await Promise.all([
    writeItem(ACCESS_KEY, tokens.accessToken),
    writeItem(REFRESH_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens() {
  accessToken = null;
  loaded = true;
  await Promise.all([deleteItem(ACCESS_KEY), deleteItem(REFRESH_KEY)]);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await readItem(REFRESH_KEY);
      if (!refreshToken) return false;
      const tokens = await rawRequest<{ accessToken: string; refreshToken: string }>(
        '/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refreshToken }) },
      );
      await setTokens(tokens);
      return true;
    } catch {
      await clearTokens();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  await loadTokens();
  try {
    return await rawRequest<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && (await tryRefresh())) {
      return rawRequest<T>(path, init);
    }
    throw err;
  }
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });
export const apiPost = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPut = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });

/** Public endpoints (search, listing detail) — no token, no refresh dance. */
export async function apiPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return (await res.json()) as T;
}
