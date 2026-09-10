import {
  PLATFORM_SETTINGS,
  SETTING_KEYS,
  coerceSetting,
  crossCheck,
  effectiveSetting,
  isSettingKey,
  settingSpec,
} from './platform-settings';

describe('platform settings registry', () => {
  describe('boolean coercion', () => {
    it('accepts real booleans', () => {
      expect(coerceSetting('offers.enabled', false)).toEqual({ ok: true, value: false });
      expect(coerceSetting('offers.enabled', true)).toEqual({ ok: true, value: true });
    });

    /**
     * The defect this registry was written for. The admin console posted the
     * raw contents of a text box, so "false" was stored as a string — and
     * every read of it (`if (await settings.offersEnabled())`) saw a truthy
     * value. An admin switching offers OFF switched them ON.
     */
    it('reads the string "false" as false, not as a truthy string', () => {
      const r = coerceSetting('offers.enabled', 'false');
      expect(r).toEqual({ ok: true, value: false });
      if (r.ok) expect(r.value).toBe(false);
    });

    it('accepts "TRUE" regardless of case or padding', () => {
      expect(coerceSetting('offers.enabled', '  TRUE ')).toEqual({ ok: true, value: true });
    });

    it('refuses anything it would have to guess at', () => {
      for (const bad of ['yes', 'on', '1', '', 0, 1, null, {}, []]) {
        expect(coerceSetting('offers.enabled', bad).ok).toBe(false);
      }
    });
  });

  describe('number coercion', () => {
    it('accepts numbers and fully-numeric strings', () => {
      expect(coerceSetting('assignment.max_agents', 5)).toEqual({ ok: true, value: 5 });
      expect(coerceSetting('assignment.max_agents', '5')).toEqual({ ok: true, value: 5 });
    });

    it('refuses a partly-numeric string rather than parseInt-ing the front of it', () => {
      expect(coerceSetting('assignment.max_agents', '5 agents').ok).toBe(false);
      expect(coerceSetting('assignment.max_agents', '').ok).toBe(false);
    });

    it('enforces the declared bounds', () => {
      expect(coerceSetting('assignment.max_agents', 0).ok).toBe(false);
      expect(coerceSetting('assignment.max_agents', 11).ok).toBe(false);
      expect(coerceSetting('assignment.max_agents', 10).ok).toBe(true);
    });

    it('enforces whole numbers where the unit is countable', () => {
      expect(coerceSetting('assignment.max_agents', 2.5).ok).toBe(false);
      // …and admits decimals where the unit is a percentage.
      expect(coerceSetting('alerts.price_drop_min_pct', 2.5)).toEqual({ ok: true, value: 2.5 });
    });

    /** A zero threshold would alert on a wobble that netted out to nothing. */
    it('keeps the price-drop threshold above zero', () => {
      expect(coerceSetting('alerts.price_drop_min_pct', 0).ok).toBe(false);
      expect(coerceSetting('alerts.price_drop_min_pct', 0.1).ok).toBe(true);
    });
  });

  describe('enum coercion', () => {
    it('accepts declared options only', () => {
      expect(coerceSetting('resale.mode', 'agent_only')).toEqual({ ok: true, value: 'agent_only' });
      expect(coerceSetting('resale.mode', 'owner_direct_allowed').ok).toBe(true);
      expect(coerceSetting('resale.mode', 'anything_goes').ok).toBe(false);
    });

    it('names the options in the refusal, so the caller is not left guessing', () => {
      const r = coerceSetting('resale.mode', 'nope');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('agent_only');
    });
  });

  describe('effective value', () => {
    it('falls back to the declared default when nothing is stored', () => {
      expect(effectiveSetting('moderation.warnings_before_ban', null)).toEqual({ value: 3, source: 'default' });
      expect(effectiveSetting('moderation.warnings_before_ban', undefined).source).toBe('default');
    });

    it('uses the stored value when it is valid', () => {
      expect(effectiveSetting('moderation.warnings_before_ban', 2)).toEqual({ value: 2, source: 'stored' });
    });

    /**
     * A row written before a bound existed must not propagate a value the code
     * is not prepared for — but substituting silently would hide it, so the
     * reason comes back with the fallback.
     */
    it('falls back and explains when a stored value no longer coerces', () => {
      const r = effectiveSetting('assignment.max_agents', 99);
      expect(r.value).toBe(3);
      expect(r.source).toBe('default');
      expect(r.invalid).toContain('between 1 and 10');
    });

    it('does not let a stored "false" resolve to true', () => {
      expect(effectiveSetting('offers.enabled', 'false').value).toBe(false);
    });
  });

  describe('cross-field rules', () => {
    it('refuses a minimum term above the maximum', () => {
      expect(crossCheck({ 'assignment.min_term_months': 12, 'assignment.max_term_months': 6 })).toContain(
        'cannot exceed',
      );
    });

    it('allows equal bounds', () => {
      expect(crossCheck({ 'assignment.min_term_months': 6, 'assignment.max_term_months': 6 })).toBeNull();
    });
  });

  describe('the registry itself', () => {
    it('declares a valid default for every setting', () => {
      for (const key of SETTING_KEYS) {
        const spec = settingSpec(key);
        expect(coerceSetting(key, spec.default)).toEqual({ ok: true, value: spec.default });
      }
    });

    it('defaults satisfy the cross-field rules, so a fresh install is coherent', () => {
      const defaults = Object.fromEntries(SETTING_KEYS.map((k) => [k, settingSpec(k).default]));
      expect(crossCheck(defaults)).toBeNull();
    });

    it('describes every setting and names what reads it', () => {
      for (const key of SETTING_KEYS) {
        const spec = settingSpec(key);
        expect(spec.description.length).toBeGreaterThan(20);
        expect(spec.readBy.length).toBeGreaterThan(3);
      }
    });

    it('recognises its own keys and nothing else', () => {
      expect(isSettingKey('offers.enabled')).toBe(true);
      // The Phase-1 key that was seeded but never read.
      expect(isSettingKey('reviews.warnings_before_ban')).toBe(false);
      // Not a key just because Object.prototype has one.
      expect(isSettingKey('toString')).toBe(false);
      expect(isSettingKey('constructor')).toBe(false);
    });

    it('keys are namespaced, so the console can group them', () => {
      for (const key of Object.keys(PLATFORM_SETTINGS)) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    });
  });
});
