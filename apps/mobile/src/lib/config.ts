import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the API lives.
 *
 * `localhost` means the device, not the dev machine, so a phone running the
 * app over Expo Go cannot reach it. Metro already knows the LAN address it
 * served the bundle from, so reuse that host and only fall back to the value
 * in app.json when it is unavailable (web, or a production build).
 */
function inferDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((Constants.expoGoConfig as any)?.debuggerHost as string | undefined);
  const host = hostUri?.split(':')[0];
  if (!host) return null;
  // The web preview runs in a browser on the dev machine itself, where
  // localhost is correct and the LAN address may not be reachable.
  if (Platform.OS === 'web') return null;
  return `http://${host}:4000`;
}

const configured = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase;

export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? inferDevHost() ?? configured ?? 'http://localhost:4000';
