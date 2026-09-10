import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LEGACY_SETTINGS,
  SETTING_KEYS,
  type SettingKey,
  type SettingValue,
  coerceSetting,
  crossCheck,
  effectiveSetting,
  isSettingKey,
  settingSpec,
} from '../../common/platform-settings';

/**
 * Main-admin platform configuration (§13.4/§13.5) — everything runtime-editable.
 *
 * Every knob is declared in `common/platform-settings`, which is what makes
 * reads typed and writes safe: a value is coerced to its declared type before
 * it is stored, and an undeclared key is refused outright rather than becoming
 * a row that looks live in the console and is read by nothing.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The effective value of a declared setting. The default lives with the
   * declaration, so a call site cannot hold a second copy that drifts — which
   * `assignment.max_agents` did, in two files, before this existed.
   */
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    const resolved = effectiveSetting(key, row?.value ?? null);
    if (resolved.invalid) {
      this.logger.warn(`Stored value for ${key} is unusable, falling back to the default: ${resolved.invalid}`);
    }
    return resolved.value as SettingValue<K>;
  }

  /**
   * Write a setting, or reset it to its default with `null`.
   *
   * Reset is a first-class operation rather than "type the default back in":
   * a row equal to the default and no row at all behave identically, but only
   * the second keeps following the default if the default is ever revised.
   */
  async set(key: string, value: unknown) {
    if (!isSettingKey(key)) {
      const legacy = LEGACY_SETTINGS.find((l) => l.key === key);
      // The replacement comes first: an operator who mistyped a key needs the
      // right one before they need the history of the wrong one.
      throw new BadRequestException(
        legacy
          ? `${key} is retired and read by nothing${legacy.replacedBy ? `; use ${legacy.replacedBy} instead` : ''}. ${legacy.reason}`
          : `${key} is not a platform setting. Declare it in common/platform-settings first, or nothing will read it.`,
      );
    }

    if (value === null) {
      await this.prisma.platformSetting.deleteMany({ where: { key } });
      return { key, value: settingSpec(key).default, source: 'default' as const };
    }

    const coerced = coerceSetting(key, value);
    if (!coerced.ok) throw new BadRequestException(coerced.error);

    // Cross-field rules are checked against the state this write would create,
    // not the current one — otherwise a pair of writes that is invalid only in
    // combination would each pass on its own.
    const rows = await this.prisma.platformSetting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const projected: Record<string, boolean | number | string> = {};
    for (const k of SETTING_KEYS) {
      projected[k] = k === key ? coerced.value : effectiveSetting(k, stored.get(k) ?? null).value;
    }
    const conflict = crossCheck(projected);
    if (conflict) throw new BadRequestException(conflict);

    await this.prisma.platformSetting.upsert({
      where: { key },
      update: { value: coerced.value },
      create: { key, value: coerced.value },
    });
    return { key, value: coerced.value, source: 'stored' as const };
  }

  /**
   * Every declared setting with its effective value, plus any row in the table
   * that no longer answers to a declaration. Rows are returned in one flat
   * list — a console that separated them would let an unrecognised row look
   * like an ordinary control, which is the state this replaced.
   */
  async all() {
    const rows = await this.prisma.platformSetting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));

    const declared = SETTING_KEYS.map((key) => {
      const spec = settingSpec(key);
      const resolved = effectiveSetting(key, stored.get(key) ?? null);
      return {
        key,
        value: resolved.value,
        declared: true as const,
        source: resolved.source,
        invalid: resolved.invalid ?? null,
        type: spec.type,
        default: spec.default,
        description: spec.description,
        readBy: spec.readBy,
        seamNote: spec.seamNote ?? null,
        ...(spec.type === 'number' ? { min: spec.min, max: spec.max, integer: spec.integer, unit: spec.unit ?? null } : {}),
        ...(spec.type === 'enum' ? { options: spec.options } : {}),
      };
    });

    const unrecognised = rows
      .filter((r) => !isSettingKey(r.key))
      .map((r) => ({
        key: r.key,
        value: r.value,
        declared: false as const,
        source: 'stored' as const,
        reason:
          LEGACY_SETTINGS.find((l) => l.key === r.key)?.reason ??
          'No code reads this key. It was written to the table but answers to no declaration.',
      }));

    return [...declared, ...unrecognised].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Public subset needed by owner/agent UIs. */
  async publicSettings() {
    return {
      maxAgents: await this.get('assignment.max_agents'),
      minTermMonths: await this.get('assignment.min_term_months'),
      maxTermMonths: await this.get('assignment.max_term_months'),
      resaleMode: await this.get('resale.mode'),
      offersEnabled: await this.offersEnabled(),
    };
  }

  /**
   * FX rates for *display only* (Plan §6.1 "price range in user currency,
   * converted", §12 "multi-currency display").
   *
   * Everything is stored and transacted in GBP; these let a browser show an
   * indicative equivalent. Rates are quoted per 1 GBP, so converting is a
   * multiply. `fetchedAt` is returned so the client can say how fresh the
   * number is rather than implying it is a live quote — the seed is static
   * until a refresh job exists.
   */
  async fxRates() {
    const rows = await this.prisma.fxRate.findMany({
      where: { base: 'GBP' },
      select: { quote: true, rate: true, fetchedAt: true },
      orderBy: { quote: 'asc' },
    });
    return {
      base: 'GBP',
      fetchedAt: rows[0]?.fetchedAt ?? null,
      rates: Object.fromEntries(rows.map((r) => [r.quote, Number(r.rate)])),
    };
  }

  /**
   * Offers are switched OFF by default (change log 2026-08-10). Everything
   * behind them — negotiation, and the offer-accept that opens a property deal
   * room — is intact and comes back the moment this is flipped, rather than
   * being deleted and needing a rebuild.
   */
  async offersEnabled(): Promise<boolean> {
    return this.get('offers.enabled');
  }

  // ── profit bands (§13.5) ─────────────────────────────────────────

  listBands() {
    return this.prisma.profitBand.findMany({ orderBy: { minPriceGbp: 'asc' } });
  }

  createBand(data: { minPriceGbp: number; maxPriceGbp: number; profitGbp: number }) {
    if (data.maxPriceGbp <= data.minPriceGbp) throw new BadRequestException('max must exceed min');
    return this.prisma.profitBand.create({ data });
  }

  updateBand(id: string, data: Partial<{ minPriceGbp: number; maxPriceGbp: number; profitGbp: number; active: boolean }>) {
    return this.prisma.profitBand.update({ where: { id }, data });
  }

  deleteBand(id: string) {
    return this.prisma.profitBand.delete({ where: { id } });
  }

  /** Platform profit for an asking price (GBP). Buyer-pays (§13.5 decision). */
  async profitFor(priceGbp: number): Promise<number> {
    const band = await this.prisma.profitBand.findFirst({
      where: { active: true, minPriceGbp: { lte: priceGbp }, maxPriceGbp: { gt: priceGbp } },
      orderBy: { minPriceGbp: 'desc' },
    });
    if (!band) throw new BadRequestException(`No active profit band covers £${priceGbp} — configure one in admin settings`);
    return Number(band.profitGbp);
  }
}
