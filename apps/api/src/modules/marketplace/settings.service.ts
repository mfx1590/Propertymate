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
    };
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
