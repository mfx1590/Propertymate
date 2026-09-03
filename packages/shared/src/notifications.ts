/**
 * Notification template registry (Plan §6.6).
 *
 * Which channels a template uses is product policy, not per-call-site choice —
 * every `notify()` in the codebase passes only a template key, so changing
 * "offers should also email" is a one-line change here rather than a hunt
 * through the modules that raise the event.
 */

export type NotificationChannel = 'in_app' | 'push' | 'email' | 'whatsapp';

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email', 'whatsapp'];

/**
 * Categories are the templateKey prefix (`offer.received` → `offer`), so the
 * preferences UI groups by something the user recognises without a second
 * mapping table to keep in sync.
 */
export const NOTIFICATION_CATEGORIES = [
  'verification',
  'profile',
  'availability',
  'assignment',
  'chat',
  'viewing',
  'offer',
  'deal',
  'project',
  'moderation',
  'discovery',
  'legal',
  'dispute',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function categoryOf(templateKey: string): NotificationCategory | null {
  const prefix = templateKey.split('.')[0] as NotificationCategory;
  return NOTIFICATION_CATEGORIES.includes(prefix) ? prefix : null;
}

/**
 * Default channels per category. In-app is on everywhere and is not
 * user-disableable — it is the record of what happened, not a notification
 * the user opted into.
 *
 * Money- and calendar-critical categories reach outside the app by default;
 * chat does not, because a busy thread would otherwise mean an email per line.
 */
export const DEFAULT_CHANNELS: Record<NotificationCategory, NotificationChannel[]> = {
  verification: ['in_app', 'push', 'email'],
  profile: ['in_app', 'push', 'email'],
  // §4 freshness nudges are explicitly push + WhatsApp + email
  availability: ['in_app', 'push', 'email', 'whatsapp'],
  assignment: ['in_app', 'push', 'email'],
  chat: ['in_app', 'push'],
  viewing: ['in_app', 'push', 'email', 'whatsapp'],
  offer: ['in_app', 'push', 'email', 'whatsapp'],
  deal: ['in_app', 'push', 'email'],
  project: ['in_app', 'push'],
  // A removed review, a warning or a ban has to reach the person even if they
  // never open the app again — email is not optional here in practice.
  moderation: ['in_app', 'push', 'email'],
  // §6.1 saved-search and price-drop alerts. Email is the channel that
  // actually brings someone back days later; WhatsApp is deliberately absent
  // — a marketing-shaped nudge there is how a business number gets reported.
  discovery: ['in_app', 'push', 'email'],
  // §10.2 lawyer marketplace. A quote request and its answer sit on the
  // critical path of a purchase — a lawyer who misses one loses the work and a
  // buyer who misses one stalls at `legal_check` — so this reaches outside the
  // app like the other money-adjacent categories. WhatsApp is left out: the
  // templates would need Meta approval in four languages before the first
  // engagement exists to justify it.
  legal: ['in_app', 'push', 'email'],
  // A dispute opened against you, a paused deal, a decision — nothing in this
  // category is optional reading, and the person least likely to be in the app
  // is the one being complained about. Email is the channel that reaches them.
  dispute: ['in_app', 'push', 'email'],
};

/** in_app is always delivered; the preferences API refuses to switch it off. */
export const MANDATORY_CHANNELS: NotificationChannel[] = ['in_app'];

export function channelsFor(
  templateKey: string,
  override?: NotificationChannel[] | null,
): NotificationChannel[] {
  const category = categoryOf(templateKey);
  const base = override ?? (category ? DEFAULT_CHANNELS[category] : ['in_app']);
  return [...new Set([...MANDATORY_CHANNELS, ...base])];
}
