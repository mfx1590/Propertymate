/** EN default; RTL required for Farsi (Plan §1). */
export const LOCALES = ['en', 'tr', 'ru', 'fa'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const RTL_LOCALES: Locale[] = ['fa'];

export type I18nText = Partial<Record<Locale, string>>;

/** TRNC regions taxonomy top level (Plan §1). Sub-districts seeded as children. */
export const REGION_SLUGS = [
  'kyrenia',
  'famagusta',
  'iskele',
  'nicosia',
  'guzelyurt',
  'lefke',
] as const;
