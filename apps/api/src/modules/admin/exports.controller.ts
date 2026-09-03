import { Controller, Get, Ip, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ExportsService, type AuditFilter } from './exports.service';

function parseDate(raw: string | undefined, label: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`${label} is not a date`);
  return d;
}

function auditFilterFrom(q: Record<string, string | undefined>): AuditFilter {
  return {
    actorId: q.actorId || undefined,
    entityType: q.entityType || undefined,
    entityId: q.entityId || undefined,
    action: q.action || undefined,
    from: parseDate(q.from, 'from'),
    to: parseDate(q.to, 'to'),
  };
}

/**
 * The audit-log browser (§6.7). `audit.view` finally gates something — it was
 * seeded to admin in Phase 1 and this is the first route to check it.
 */
@RequirePermissions('audit.view')
@Controller('admin/audit')
export class AuditBrowserController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  browse(
    @Query() q: Record<string, string | undefined>,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.exports.browseAudit(auditFilterFrom(q), cursor, limit ? Number(limit) : undefined);
  }

  @Get('actions')
  actions() {
    return this.exports.auditActions();
  }
}

/**
 * CSV exports. Gated on `user.manage` rather than a new permission: the
 * people who can read every user in the console are the people who may take
 * that data away in a file, and the export is audited either way.
 */
@RequirePermissions('user.manage')
@Controller('admin/exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  datasets() {
    return this.exports.datasets();
  }

  /**
   * `@Res()` without passthrough: the service owns the response because it
   * streams. Errors before the first byte still surface as normal exceptions.
   */
  @Get(':dataset')
  async download(
    @CurrentUser() admin: AuthUser,
    @Param('dataset') dataset: string,
    @Query() q: Record<string, string | undefined>,
    @Ip() ip: string,
    @Res() res: Response,
  ) {
    try {
      await this.exports.streamCsv(admin.sub, dataset, res, {
        auditFilter: dataset === 'audit' ? auditFilterFrom(q) : undefined,
        ip,
      });
    } catch (err) {
      // Nothing has been written yet when a dataset is unknown or a filter is
      // malformed, so a JSON error is still possible — and better than a
      // 200 with an empty file.
      if (!res.headersSent) {
        const status = (err as { status?: number }).status ?? 400;
        res.status(status).json({ statusCode: status, message: (err as Error).message });
      } else {
        res.end();
      }
    }
  }
}
