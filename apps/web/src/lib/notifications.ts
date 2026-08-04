/** Notification channel preferences (Plan §6.6). */

export type NotificationChannel = 'in_app' | 'push' | 'email' | 'whatsapp';

export const ALL_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email', 'whatsapp'];

export interface CategoryPreference {
  category: string;
  channels: NotificationChannel[];
  /** true while the user has never overridden the platform default */
  isDefault: boolean;
}

export interface NotificationPreferences {
  mandatory: NotificationChannel[];
  categories: CategoryPreference[];
}

export type DeliveryStatus = 'sent' | 'skipped' | 'failed' | 'queued';

export interface DeliveryRow {
  id: string;
  channel: NotificationChannel;
  templateKey: string;
  status: DeliveryStatus;
  sentAt: string | null;
  failedAt: string | null;
  error: string | null;
  createdAt: string;
}

export const DELIVERY_STATUS_STYLES: Record<DeliveryStatus, string> = {
  sent: 'bg-emerald-50 text-emerald-700',
  skipped: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-50 text-red-700',
  queued: 'bg-amber-50 text-amber-700',
};
