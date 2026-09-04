import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CSV_BOM, csvRow } from '../../common/csv';

/** Rows fetched per round trip while streaming. */
const BATCH = 500;

export const EXPORT_DATASETS = [
  'users',
  'listings',
  'deals',
  'subscriptions',
  'payments',
  'disputes',
  'audit',
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export interface AuditFilter {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

/**
 * Admin data export + the audit-log browser (Plan §6.7 "audit log browser",
 * §10.2 Phase 3 "data export/reporting for admins").
 *
 * The audit table has been written by every action since step 1 and, until
 * now, read by nothing — `audit.view` was seeded to admin in Phase 1 and no
 * route ever checked it. That is the third seeded-but-unread seam this phase
 * has cashed in (after `injectableServiceTypes` and the `withdrawn` status).
 *
 * **Exports are streamed, not buffered.** A batch cursor walks the table and
 * writes rows as it goes, so a 100k-row export costs 500 rows of memory. And
 * **an export is itself an audited event** — who pulled which dataset, with
 * which filters, and how many rows left the building. It is the single most
 * useful line this log will ever hold.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── audit-log browser ────────────────────────────────────────────

  async browseAudit(filter: AuditFilter, cursor?: string, limit = 50) {
    const take = Math.min(200, Math.max(1, limit));
    const rows = await this.prisma.auditLog.findMany({
      where: this.auditWhere(filter),
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    // Actor identity resolved here rather than joined: audit_logs keeps a bare
    // actor id on purpose (a deleted account must not orphan its history).
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, phone: true, email: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actor: r.actorId ? (byId.get(r.actorId) ?? null) : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        ip: r.ip,
        createdAt: r.createdAt,
      })),
      nextCursor: rows.length === take ? rows[rows.length - 1].id : null,
    };
  }

  /** Distinct action keys, for a filter dropdown that cannot go stale. */
  async auditActions(): Promise<string[]> {
    const grouped = await this.prisma.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } });
    return grouped.map((g) => g.action);
  }

  private auditWhere(f: AuditFilter) {
    if (f.from && f.to && f.from > f.to) throw new BadRequestException('from must precede to');
    return {
      ...(f.actorId ? { actorId: f.actorId } : {}),
      ...(f.entityType ? { entityType: f.entityType } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.action ? { action: f.action } : {}),
      ...(f.from || f.to
        ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
        : {}),
    };
  }

  // ── exports ──────────────────────────────────────────────────────

  /** What can be exported, with a live row count per dataset. */
  async datasets() {
    const [users, listings, deals, subscriptions, payments, disputes, audit] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.property.count({ where: { deletedAt: null } }),
      this.prisma.deal.count(),
      this.prisma.subscription.count(),
      this.prisma.paymentLedgerEntry.count(),
      this.prisma.dispute.count(),
      this.prisma.auditLog.count(),
    ]);
    return { users, listings, deals, subscriptions, payments, disputes, audit };
  }

  /**
   * Stream one dataset as CSV onto the response. The audit row is written
   * after the data but BEFORE the response is ended, with the real row count
   * — so an export that failed halfway is logged as what it was, and by the
   * time a client sees the download complete, the record of it exists. The
   * first version ended the response first and wrote the row after; the
   * client then read the audit trail before the row landed, on a runner
   * where the database was a few milliseconds slower than the socket.
   */
  async streamCsv(
    adminId: string,
    dataset: string,
    res: Response,
    opts: { auditFilter?: AuditFilter; ip?: string } = {},
  ) {
    if (!(EXPORT_DATASETS as readonly string[]).includes(dataset)) {
      throw new NotFoundException(`Unknown dataset ${dataset}`);
    }
    const ds = dataset as ExportDataset;
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="propverify-${ds}-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.write(CSV_BOM);

    let rowCount = 0;
    try {
      rowCount = await this.writeDataset(ds, res, opts.auditFilter ?? {});
    } finally {
      try {
        await this.audit.log({
          actorId: adminId,
          action: 'data.export',
          entityType: 'export',
          entityId: ds,
          // Dates in the filter serialised to strings — the audit column is JSON.
          after: JSON.parse(JSON.stringify({ dataset: ds, rowCount, filter: opts.auditFilter ?? null })),
          ip: opts.ip,
        });
      } finally {
        // Whatever happened to the audit write, the client must not hang.
        res.end();
      }
    }
  }

  private async writeDataset(ds: ExportDataset, res: Response, auditFilter: AuditFilter): Promise<number> {
    switch (ds) {
      case 'users':
        res.write(csvRow(['id', 'phone', 'email', 'locale', 'status', 'roles', 'created_at']));
        // Never the password hash, never a refresh token: the columns are
        // enumerated, not spread from the row.
        return this.walk(
          (cursor) =>
            this.prisma.user.findMany({
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
              take: BATCH,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
              select: {
                id: true, phone: true, email: true, locale: true, status: true, createdAt: true,
                userRoles: { select: { role: { select: { key: true } } } },
              },
            }),
          (u) => [u.id, u.phone, u.email, u.locale, u.status, u.userRoles.map((r) => r.role.key).join('|'), u.createdAt],
          res,
        );

      case 'listings':
        res.write(csvRow([
          'id', 'kind', 'status', 'region', 'title_en', 'price_base_gbp', 'list_price_gbp', 'deed_type',
          'bedrooms', 'area_m2', 'created_by', 'published_by_agent', 'created_at',
        ]));
        return this.walk(
          (cursor) =>
            this.prisma.property.findMany({
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
              take: BATCH,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
              select: {
                id: true, kind: true, status: true, titleI18n: true, priceBaseGbp: true, listPriceGbp: true,
                deedType: true, bedrooms: true, areaM2: true, createdByUserId: true, publishedByAgentId: true,
                createdAt: true, region: { select: { slug: true } },
              },
            }),
          (p) => [
            p.id, p.kind, p.status, p.region.slug, (p.titleI18n as { en?: string })?.en ?? '',
            Number(p.priceBaseGbp), p.listPriceGbp === null ? '' : Number(p.listPriceGbp), p.deedType,
            p.bedrooms, p.areaM2, p.createdByUserId, p.publishedByAgentId, p.createdAt,
          ],
          res,
        );

      case 'deals':
        res.write(csvRow(['id', 'kind', 'status', 'current_stage', 'price_agreed', 'currency', 'buyer', 'seller', 'created_at', 'completed_at']));
        return this.walk(
          (cursor) =>
            this.prisma.deal.findMany({
              orderBy: { id: 'asc' },
              take: BATCH,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
              select: {
                id: true, kind: true, status: true, currentStageKey: true, createdAt: true, completedAt: true,
                snapshot: { select: { priceAgreed: true, currency: true } },
                parties: { select: { userId: true, partyRole: true } },
              },
            }),
          (d) => [
            d.id, d.kind, d.status, d.currentStageKey,
            d.snapshot ? Number(d.snapshot.priceAgreed) : '', d.snapshot?.currency ?? '',
            d.parties.find((p) => p.partyRole === 'buyer')?.userId ?? '',
            d.parties.find((p) => p.partyRole === 'seller')?.userId ?? '',
            d.createdAt, d.completedAt,
          ],
          res,
        );

      case 'subscriptions':
        res.write(csvRow(['id', 'user_id', 'plan', 'status', 'starts_at', 'ends_at', 'granted_by_admin']));
        return this.walk(
          (cursor) =>
            this.prisma.subscription.findMany({
              orderBy: { id: 'asc' },
              take: BATCH,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
              select: {
                id: true, userId: true, status: true, startsAt: true, endsAt: true, grantedByAdminId: true,
                plan: { select: { key: true } },
              },
            }),
          (s) => [s.id, s.userId, s.plan.key, s.status, s.startsAt, s.endsAt, s.grantedByAdminId],
          res,
        );

      case 'payments':
        res.write(csvRow([
          'id', 'user_id', 'kind', 'plan', 'list_amount', 'amount', 'currency', 'status', 'provider',
          'provider_ref', 'period_start', 'period_end', 'occurred_at', 'recorded_by_admin', 'reverses_entry',
        ]));
        return this.walk(
          (cursor) =>
            this.prisma.paymentLedgerEntry.findMany({
              orderBy: { id: 'asc' },
              take: BATCH,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            }),
          (e) => [
            e.id, e.userId, e.kind, e.planKey, Number(e.listAmount), Number(e.amount), e.currency, e.status,
            e.provider, e.providerRef, e.periodStart, e.periodEnd, e.occurredAt, e.recordedByAdminId, e.reversesEntryId,
          ],
          res,
        );

      case 'disputes':
        res.write(csvRow(['id', 'deal_id', 'opened_by', 'against', 'status', 'reason', 'resolution_note', 'resolved_by_admin', 'created_at']));
        return this.walk(
          (cursor) =>
            this.prisma.dispute.findMany({
              orderBy: { id: 'asc' },
              take: BATCH,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            }),
          (d) => [d.id, d.dealId, d.openedBy, d.againstUserId, d.status, d.reason, d.resolutionNote, d.resolvedByAdminId, d.createdAt],
          res,
        );

      case 'audit':
        res.write(csvRow(['id', 'created_at', 'actor_id', 'action', 'entity_type', 'entity_id', 'ip', 'before', 'after']));
        return this.walk(
          (cursor) =>
            this.prisma.auditLog.findMany({
              where: this.auditWhere(auditFilter),
              orderBy: { id: 'asc' },
              take: BATCH,
              ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            }),
          (a) => [a.id, a.createdAt, a.actorId, a.action, a.entityType, a.entityId, a.ip, a.before, a.after],
          res,
        );
    }
  }

  /** Cursor-walk a table in batches, writing one CSV line per row. */
  private async walk<T extends { id: string }>(
    fetch: (cursor: string | undefined) => Promise<T[]>,
    toRow: (row: T) => unknown[],
    res: Response,
  ): Promise<number> {
    let cursor: string | undefined;
    let count = 0;
    for (;;) {
      const batch = await fetch(cursor);
      for (const row of batch) {
        res.write(csvRow(toRow(row)));
        count++;
      }
      if (batch.length < BATCH) return count;
      cursor = batch[batch.length - 1].id;
    }
  }
}
