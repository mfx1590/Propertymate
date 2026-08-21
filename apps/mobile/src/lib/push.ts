import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiDelete, apiPost } from './api';

/**
 * Expo push registration (Plan §6.6) — the client half of the push channel the
 * API has had waiting since Phase 2 step 4.
 *
 * The API's PushProvider needs no credentials (Expo's free tier), so the only
 * thing standing between a notification and a device is a registered token.
 */

// Foreground behaviour: the API also delivers in-app over the socket, but a
// banner is still wanted — the user may be on an unrelated screen.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

let registered: string | null = null;

/** Expo needs the EAS project id to mint a token in a production build. */
function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Constants as any)?.easConfig?.projectId
  );
}

export async function registerPushToken(): Promise<string | null> {
  // A simulator has no push service, and the web preview has no native module
  // at all — both would throw rather than return an error.
  if (Platform.OS === 'web' || !Device.isDevice) return null;

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      // Ask only once; a user who declined should not be nagged on every launch.
      if (!existing.canAskAgain) return null;
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#0d5f58',
      });
    }

    const id = projectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : {});
    if (!token || token === registered) return token ?? null;

    await apiPost('/users/me/push-tokens', { token, platform: Platform.OS });
    registered = token;
    return token;
  } catch {
    // Never let push break sign-in — a missing notification is recoverable,
    // a blocked login is not.
    return null;
  }
}

export async function unregisterPushToken(): Promise<void> {
  if (!registered) return;
  try {
    await apiDelete(`/users/me/push-tokens/${encodeURIComponent(registered)}`);
  } catch {
    /* signing out locally matters more than the server-side cleanup */
  } finally {
    registered = null;
  }
}
