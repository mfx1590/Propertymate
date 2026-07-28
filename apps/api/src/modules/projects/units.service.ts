import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CURRENCIES } from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ProjectsService } from './projects.service';
import { UnitDto, UpdateUnitDto } from './dto/projects.dto';

/** Header names accepted by the bulk importer, in canonical order. */
const CSV_COLUMNS = ['unit_no', 'type', 'bedrooms', 'area_m2', 'floor', 'price', 'currency'] as const;

export interface ImportReport {
  created: number;
  updated: number;
  skipped: Array<{ line: number; reason: string }>;
}

/**
 * Unit inventory (Plan §6.3): inline editor plus bulk CSV import, and the
 * availability grid the public project page renders.
 */
@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
    private readonly events: EventEmitter2,
  ) {}

  async list(userId: string, projectId: string) {
    await this.projects.assertOwned(userId, projectId);
    const units = await this.prisma.projectUnit.findMany({
      where: { projectId },
      orderBy: [{ floor: 'asc' }, { unitNo: 'asc' }],
    });
    // the developer's own grid may show who holds a unit — the public one may not
    const deals = await this.prisma.deal.findMany({
      where: { projectUnitId: { in: units.map((u) => u.id) } },
      select: { id: true, projectUnitId: true, status: true, currentStageKey: true },
    });
    return units.map((u) => ({
      ...u,
      deal: deals.find((d) => d.projectUnitId === u.id) ?? null,
    }));
  }

  async create(userId: string, projectId: string, dto: UnitDto, ip?: string) {
    await this.projects.assertOwned(userId, projectId);
    const clash = await this.prisma.projectUnit.findUnique({
      where: { projectId_unitNo: { projectId, unitNo: dto.unitNo } },
    });
    if (clash) throw new BadRequestException(`Unit ${dto.unitNo} already exists`);

    const unit = await this.prisma.projectUnit.create({
      data: {
        projectId,
        unitNo: dto.unitNo,
        type: dto.type ?? null,
        bedrooms: dto.bedrooms ?? null,
        areaM2: dto.areaM2 ?? null,
        floor: dto.floor ?? null,
        priceAmount: dto.priceAmount,
        priceCurrency: dto.priceCurrency,
      },
    });
    await this.audit.log({
      actorId: userId,
      action: 'project.unit_created',
      entityType: 'project',
      entityId: projectId,
      after: { unitNo: dto.unitNo, priceAmount: dto.priceAmount },
      ip,
    });
    this.events.emit('project.updated', { projectId });
    return unit;
  }

  async update(userId: string, projectId: string, unitId: string, dto: UpdateUnitDto, ip?: string) {
    await this.projects.assertOwned(userId, projectId);
    const unit = await this.prisma.projectUnit.findFirst({ where: { id: unitId, projectId } });
    if (!unit) throw new NotFoundException('Unit not found');
    if (unit.status === 'sold') throw new BadRequestException('Sold units are frozen');
    if (dto.status === 'available' && unit.status === 'reserved') {
      const held = await this.prisma.deal.count({
        where: { projectUnitId: unitId, status: 'active' },
      });
      if (held > 0) throw new BadRequestException('Cancel the reservation deal before releasing this unit');
    }

    const updated = await this.prisma.projectUnit.update({
      where: { id: unitId },
      data: {
        type: dto.type ?? undefined,
        bedrooms: dto.bedrooms ?? undefined,
        areaM2: dto.areaM2 ?? undefined,
        floor: dto.floor ?? undefined,
        priceAmount: dto.priceAmount ?? undefined,
        priceCurrency: dto.priceCurrency ?? undefined,
        status: dto.status ?? undefined,
      },
    });
    await this.audit.log({
      actorId: userId,
      action: 'project.unit_updated',
      entityType: 'project',
      entityId: projectId,
      after: { unitId, ...dto } as object,
      ip,
    });
    this.events.emit('project.updated', { projectId });
    return updated;
  }

  async remove(userId: string, projectId: string, unitId: string, ip?: string) {
    await this.projects.assertOwned(userId, projectId);
    const unit = await this.prisma.projectUnit.findFirst({ where: { id: unitId, projectId } });
    if (!unit) throw new NotFoundException('Unit not found');
    if (unit.status !== 'available') {
      throw new BadRequestException(`Only available units can be removed (this one is ${unit.status})`);
    }
    await this.prisma.projectUnit.delete({ where: { id: unitId } });
    await this.audit.log({
      actorId: userId,
      action: 'project.unit_removed',
      entityType: 'project',
      entityId: projectId,
      after: { unitId, unitNo: unit.unitNo },
      ip,
    });
    this.events.emit('project.updated', { projectId });
    return { ok: true };
  }

  /**
   * Bulk import. Existing unit numbers are updated in place so a developer can
   * re-upload a corrected sheet; rows that cannot be parsed are reported back
   * with their line number rather than failing the whole file.
   */
  async importCsv(userId: string, projectId: string, csv: string, ip?: string): Promise<ImportReport> {
    await this.projects.assertOwned(userId, projectId);

    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new BadRequestException('CSV needs a header row and at least one unit');

    const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const missing = ['unit_no', 'price'].filter((c) => !header.includes(c));
    if (missing.length) {
      throw new BadRequestException(
        `CSV is missing required column(s): ${missing.join(', ')}. Expected header: ${CSV_COLUMNS.join(',')}`,
      );
    }
    const col = (name: string) => header.indexOf(name);

    const report: ImportReport = { created: 0, updated: 0, skipped: [] };
    const seen = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      const lineNo = i + 1;
      const unitNo = cells[col('unit_no')]?.trim();
      if (!unitNo) {
        report.skipped.push({ line: lineNo, reason: 'missing unit_no' });
        continue;
      }
      if (seen.has(unitNo)) {
        report.skipped.push({ line: lineNo, reason: `duplicate unit_no ${unitNo} in file` });
        continue;
      }

      const price = Number(cells[col('price')]?.replace(/[, ]/g, ''));
      if (!Number.isFinite(price) || price <= 0) {
        report.skipped.push({ line: lineNo, reason: `invalid price for ${unitNo}` });
        continue;
      }
      const currency = (cells[col('currency')]?.trim().toUpperCase() || 'GBP') as string;
      if (!(CURRENCIES as readonly string[]).includes(currency)) {
        report.skipped.push({ line: lineNo, reason: `unsupported currency ${currency} for ${unitNo}` });
        continue;
      }

      const data = {
        type: cells[col('type')]?.trim() || null,
        bedrooms: intOrNull(cells[col('bedrooms')]),
        areaM2: numberOrNull(cells[col('area_m2')]),
        floor: intOrNull(cells[col('floor')]),
        priceAmount: price,
        priceCurrency: currency,
      };

      const existing = await this.prisma.projectUnit.findUnique({
        where: { projectId_unitNo: { projectId, unitNo } },
      });
      if (existing) {
        if (existing.status === 'sold') {
          report.skipped.push({ line: lineNo, reason: `${unitNo} is sold and cannot be changed` });
          continue;
        }
        await this.prisma.projectUnit.update({ where: { id: existing.id }, data });
        report.updated++;
      } else {
        await this.prisma.projectUnit.create({ data: { projectId, unitNo, ...data } });
        report.created++;
      }
      seen.add(unitNo);
    }

    await this.audit.log({
      actorId: userId,
      action: 'project.units_imported',
      entityType: 'project',
      entityId: projectId,
      after: { created: report.created, updated: report.updated, skipped: report.skipped.length },
      ip,
    });
    this.events.emit('project.updated', { projectId });
    return report;
  }
}

/** Minimal CSV field splitter honouring double-quoted cells. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseNum(raw?: string): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/** Areas must be positive; a 0 m² cell is treated as "not supplied". */
function numberOrNull(raw?: string): number | null {
  const n = parseNum(raw);
  return n !== null && n > 0 ? n : null;
}

/** Studios (0 beds) and basements (-1) are legitimate, so only round here. */
function intOrNull(raw?: string): number | null {
  const n = parseNum(raw);
  return n === null ? null : Math.round(n);
}
