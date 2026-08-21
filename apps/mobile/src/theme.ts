/** Mirrors the web's Tailwind palette (apps/web/tailwind.config.ts). */
export const colors = {
  brand50: '#eef7f2',
  brand500: '#0f766e',
  brand600: '#0d5f58',
  brand900: '#083f3a',

  text: '#111827',
  textMuted: '#6b7280',
  textFaint: '#9ca3af',

  bg: '#ffffff',
  bgMuted: '#f9fafb',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',

  success: '#047857',
  successBg: '#ecfdf5',
  warn: '#b45309',
  warnBg: '#fffbeb',
  info: '#1d4ed8',
  infoBg: '#eff6ff',
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  neutral: '#4b5563',
  neutralBg: '#f3f4f6',
  purple: '#6d28d9',
  purpleBg: '#f5f3ff',
  indigo: '#4338ca',
  indigoBg: '#eef2ff',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** Status pill colours, keyed the same way the web board keys them. */
export const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  draft: { fg: colors.neutral, bg: colors.neutralBg },
  pending_verification: { fg: colors.warn, bg: colors.warnBg },
  verified_private: { fg: colors.indigo, bg: colors.indigoBg },
  live: { fg: colors.success, bg: colors.successBg },
  paused: { fg: colors.neutral, bg: colors.neutralBg },
  under_offer: { fg: colors.info, bg: colors.infoBg },
  sold: { fg: colors.purple, bg: colors.purpleBg },
  rented: { fg: colors.purple, bg: colors.purpleBg },

  requested: { fg: colors.warn, bg: colors.warnBg },
  confirmed: { fg: colors.success, bg: colors.successBg },
  completed: { fg: colors.info, bg: colors.infoBg },
  cancelled: { fg: colors.neutral, bg: colors.neutralBg },
  no_show: { fg: colors.danger, bg: colors.dangerBg },
};
