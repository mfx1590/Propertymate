/**
 * The platform-settings registry (§13.4/§13.5 "everything runtime-editable").
 *
 * Every runtime knob the code consults is declared here once — its type, its
 * bounds, its default, and what reads it. Three things went wrong while these
 * lived only at their call sites, and each is fixed by the declaration:
 *
 *  1. **The seed and the code disagreed.** `seed.ts` wrote a
 *     `reviews.warnings_before_ban` row that nothing has ever read, while the
 *     moderation service reads `moderation.warnings_before_ban`, which was
 *     never seeded. The admin console lists whatever rows exist, so it showed
 *     one control that does nothing and none of the six live ones.
 *  2. **Defaults were duplicated.** `assignment.max_agents` had its default
 *     written out twice, in `SettingsService.publicSettings` and again in
 *     `AssignmentsService`, free to drift apart. There is now one copy.
 *  3. **Values were stored verbatim.** The console's editor sends a string,
 *     and `false` typed into it was stored as the STRING `"false"` — which is
 *     truthy. Anyone turning offers *off* through the console would have
 *     turned them ON. Coercion now happens here, before the write.
 *
 * Deliberately dependency-free: `prisma/seed.ts` imports it to seed the
 * defaults, and pulling Nest into the seed for a table of constants would be
 * a poor trade.
 */

export interface SettingSpecCommon {
  /** Operator-facing English, shown beside the key in the admin console. */
  description: string;
  /** What actually consults this — so the console can name who is listening. */
  readBy: string;
  /**
   * Set when a value this type admits is not honoured by any code path yet.
   * A knob that looks live and is not is exactly what this registry exists to
   * stop, so the seam is stated rather than left for the next audit to find.
   */
  seamNote?: string;
}

export type SettingSpec = SettingSpecCommon &
  (
    | { type: 'boolean'; default: boolean }
    | { type: 'number'; default: number; min: number; max: number; integer: boolean; unit?: string }
    | { type: 'enum'; default: string; options: readonly string[] }
  );

export const PLATFORM_SETTINGS = {
  // ── find-my-agent assignments (§13.4) ────────────────────────────
  'assignment.max_agents': {
    type: 'number',
    default: 3,
    min: 1,
    max: 10,
    integer: true,
    unit: 'agents',
    description: 'How many agents an owner may invite to one private resale.',
    readBy: 'Find-my-agent assignment (§13.4)',
  },
  'assignment.min_term_months': {
    type: 'number',
    default: 1,
    min: 1,
    max: 24,
    integer: true,
    unit: 'months',
    description: 'Shortest mandate term an owner may offer an agent.',
    readBy: 'Find-my-agent assignment (§13.4)',
  },
  'assignment.max_term_months': {
    type: 'number',
    default: 6,
    min: 1,
    max: 24,
    integer: true,
    unit: 'months',
    description: 'Longest mandate term an owner may offer an agent.',
    readBy: 'Find-my-agent assignment (§13.4)',
  },
  'mandate.required_before_publish': {
    type: 'boolean',
    default: false,
    description:
      'Require a signed agent mandate before an agent may publish an owner’s resale. Off by default so existing deployments keep working; the document and signing flow are complete either way.',
    readBy: 'Assignment publish (§13.4, step 18)',
  },
  'resale.mode': {
    type: 'enum',
    default: 'agent_only',
    options: ['agent_only', 'owner_direct_allowed'],
    description: 'Whether a verified private resale reaches the public only through an assigned agent.',
    readBy: 'Public settings payload (§13.4)',
    seamNote:
      'Only agent_only is implemented. `owner_direct_allowed` is a declared seam: the value is served to clients but no code branches on it, so selecting it changes nothing today.',
  },

  // ── offers (§13.6) ───────────────────────────────────────────────
  'offers.enabled': {
    type: 'boolean',
    default: false,
    description:
      'Whether buyers may make and counter offers. Switched off by decision on 2026-08-10; everything behind it stays built and returns the moment it is flipped.',
    readBy: 'Offers, negotiation and the offer-accept that opens a deal room',
  },

  // ── moderation (§13.2) ───────────────────────────────────────────
  'moderation.warnings_before_ban': {
    type: 'number',
    default: 3,
    min: 1,
    max: 10,
    integer: true,
    unit: 'warnings',
    description: 'Warnings a reviewer may accumulate before the account is banned (§13.2 "after 2–3 warnings, configurable").',
    readBy: 'Review moderation (§13.2)',
  },

  // ── discovery alerts (§6.1) ──────────────────────────────────────
  'alerts.price_drop_min_pct': {
    type: 'number',
    default: 1,
    min: 0.1,
    max: 50,
    integer: false,
    unit: '%',
    description:
      'Smallest net fall that earns a price-drop alert. Bounded above zero on purpose: the sweep alerts when the net movement is at or below minus this figure, so a zero threshold would fire on a wobble that ended exactly where it started.',
    readBy: 'Nightly price-drop sweep (§6.1)',
  },

  // ── referrals (§8) ───────────────────────────────────────────────
  'referral.credit_expiry_days': {
    type: 'number',
    default: 180,
    min: 1,
    max: 3650,
    integer: true,
    unit: 'days',
    description: 'How long an earned featured-listing credit stays spendable before the nightly sweep lapses it.',
    readBy: 'Referral rewards (§8)',
  },
  'referral.featured_days': {
    type: 'number',
    default: 14,
    min: 1,
    max: 365,
    integer: true,
    unit: 'days',
    description: 'How long a listing stays featured in search when a credit is spent on it.',
    readBy: 'Referral rewards (§8)',
  },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof PLATFORM_SETTINGS;

/** The value type a key resolves to, so call sites need no casts. */
export type SettingValue<K extends SettingKey> = (typeof PLATFORM_SETTINGS)[K] extends { type: 'boolean' }
  ? boolean
  : (typeof PLATFORM_SETTINGS)[K] extends { type: 'number' }
    ? number
    : string;

export const SETTING_KEYS = Object.keys(PLATFORM_SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(PLATFORM_SETTINGS, key);
}

export function settingSpec(key: SettingKey): SettingSpec {
  return PLATFORM_SETTINGS[key] as SettingSpec;
}

export type CoerceResult = { ok: true; value: boolean | number | string } | { ok: false; error: string };

/**
 * Bring a submitted value to the declared type, or say why it cannot be.
 *
 * Strings are accepted where they are unambiguous — an operator reaching for
 * curl types `true`, not `{"value":true}` — but only where they parse
 * completely. `"yes"`, `"0.5abc"` and `""` are refused rather than guessed at,
 * because the whole point is that a value which cannot be read as a boolean
 * must never end up stored as a truthy string.
 */
export function coerceSetting(key: SettingKey, raw: unknown): CoerceResult {
  const spec = settingSpec(key);

  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      if (s === 'true') return { ok: true, value: true };
      if (s === 'false') return { ok: true, value: false };
    }
    return { ok: false, error: `${key} is a true/false setting; received ${describe(raw)}` };
  }

  if (spec.type === 'number') {
    let n: number | null = null;
    if (typeof raw === 'number') n = raw;
    else if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim())) n = Number(raw.trim());
    if (n === null || !Number.isFinite(n)) {
      return { ok: false, error: `${key} is a number; received ${describe(raw)}` };
    }
    if (spec.integer && !Number.isInteger(n)) {
      return { ok: false, error: `${key} must be a whole number; received ${n}` };
    }
    if (n < spec.min || n > spec.max) {
      return { ok: false, error: `${key} must be between ${spec.min} and ${spec.max}; received ${n}` };
    }
    return { ok: true, value: n };
  }

  if (typeof raw === 'string' && (spec.options as readonly string[]).includes(raw)) {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    error: `${key} must be one of ${spec.options.join(', ')}; received ${describe(raw)}`,
  };
}

function describe(raw: unknown): string {
  if (raw === null) return 'null';
  if (raw === undefined) return 'nothing';
  if (typeof raw === 'string') return JSON.stringify(raw);
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

/**
 * The effective value of a key given whatever is stored.
 *
 * A stored value that no longer coerces — a bound tightened since it was
 * written, an enum option retired — resolves to the default rather than
 * propagating a value the code is not prepared for. `invalid` is returned so
 * the caller can say so out loud instead of silently substituting.
 */
export function effectiveSetting(
  key: SettingKey,
  stored: unknown,
): { value: boolean | number | string; source: 'default' | 'stored'; invalid?: string } {
  const spec = settingSpec(key);
  if (stored === null || stored === undefined) return { value: spec.default, source: 'default' };
  const coerced = coerceSetting(key, stored);
  if (!coerced.ok) return { value: spec.default, source: 'default', invalid: coerced.error };
  return { value: coerced.value, source: 'stored' };
}

/**
 * Rules that span two settings, which a per-key type check cannot see.
 * A minimum term above the maximum makes every mandate term invalid, and the
 * owner would meet it as an unexplained refusal three screens away.
 */
export function crossCheck(values: Record<string, boolean | number | string>): string | null {
  const min = Number(values['assignment.min_term_months']);
  const max = Number(values['assignment.max_term_months']);
  if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
    return `assignment.min_term_months (${min}) cannot exceed assignment.max_term_months (${max})`;
  }
  return null;
}

/**
 * Rows that predate the registry, or were written by a key that has since been
 * renamed. `reviews.warnings_before_ban` is the one this audit found: seeded
 * since Phase 1, read by nothing, and editable in the console as though it
 * were live. `replacedBy` lets the seed carry the value across once rather
 * than discarding what an admin deliberately typed.
 */
export const LEGACY_SETTINGS: Array<{ key: string; replacedBy?: SettingKey; reason: string }> = [
  {
    key: 'reviews.warnings_before_ban',
    replacedBy: 'moderation.warnings_before_ban',
    reason: 'Seeded in Phase 1 under a prefix no code ever read.',
  },
];
