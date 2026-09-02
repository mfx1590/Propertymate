import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Main-admin platform configuration (§13.4/§13.5) — everything runtime-editable. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }

  async set(key: string, value: unknown) {
    return this.prisma.platformSetting.upsert({
      where: { key },
      update: { value: value as object },
      create: { key, value: value as object },
    });
  }

  async all() {
    return this.prisma.platformSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /** Public subset needed by owner/agent UIs. */
  async publicSettings() {
    return {
      maxAgents: await this.get('assignment.max_agents', 3),
      minTermMonths: await this.get('assignment.min_term_months', 1),
      maxTermMonths: await this.get('assignment.max_term_months', 6),
      resaleMode: await this.get('resale.mode', 'agent_only'),
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
    return this.get('offers.enabled', false);
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
