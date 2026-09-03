import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ReviewReportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../marketplace/settings.service';

/**
 * Document types that identify a person rather than a property or a company.
 * Only these make a ban durable — a shared utility bill says nothing about who
 * is holding the account.
 */
const IDENTITY_DOCUMENT_TYPES = ['government_id', 'owner_id', 'selfie_with_id', 'signatory_id'];

/** Default from Plan §13.2 ("after 2–3 warnings, configurable"). */
const DEFAULT_WARNINGS_BEFORE_BAN = 3;
const WARNINGS_SETTING = 'moderation.warnings_before_ban';

const MAX_REASON = 1000;

/**
 * Review moderation (Plan §13.2).
 *
 * The shape of this feature follows from one rule in the spec: **profile
 * owners can never delete reviews.** So the only lever an owner has is to
 * report one, and the only lever an admin has is to remove the *message* —
 * `stars` and `tags` keep counting either way. Anything else would let a
 * professional launder their own score, which is the exact failure the
 * verification premise exists to prevent.
 *
 * Escalation lands on the reviewer, not the review: a removed comment can earn
 * a warning, and `moderation.warnings_before_ban` warnings close the account.
 * Because identities are verified and `users.phone` is unique, a closed account
 * keeps its row and the same phone cannot sign up again (auth rejects any
 * non-active status) — that is what makes the ban durable.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  private warningsBeforeBan(): Promise<number> {
    return this.settings.get(WARNINGS_SETTING, DEFAULT_WARNINGS_BEFORE_BAN);
  }

  // ── profile owner ────────────────────────────────────────────────

  /**
   * Report a review written about you. Only the subject of the review may
   * report it: a third party flagging someone else's reputation would be a
   * denial-of-service on the moderation queue.
   */
  async report(userId: string, ratingId: string, reason: string, ip?: string) {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestException('A reason is required');
    if (trimmed.length > MAX_REASON) {
      throw new BadRequestException(`Reason must be ${MAX_REASON} characters or fewer`);
    }

    const rating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
      select: { id: true, rateeId: true, revealedAt: true, comment: true, commentRemovedAt: true },
    });
    if (!rating) throw new NotFoundException('Review not found');
    if (rating.rateeId !== userId) {
      throw new ForbiddenException('You can only report a review written about you');
    }
    // A rating that is still hidden by the §6.5 reveal rule is not public yet,
    // and one with no comment has nothing an admin could remove.
    if (!rating.revealedAt) throw new BadRequestException('That review is not published yet');
    if (!rating.comment?.trim()) throw new BadRequestException('That review has no comment to report');
    if (rating.commentRemovedAt) throw new BadRequestException('That comment has already been removed');

    try {
      const created = await this.prisma.reviewReport.create({
        data: { ratingId, reportedByUserId: userId, reason: trimmed },
        select: { id: true, status: true, createdAt: true },
      });
      await this.audit.log({
        actorId: userId,
        action: 'review.reported',
        entityType: 'rating',
        entityId: ratingId,
        after: { reportId: created.id, reason: trimmed },
        ip,
      });
      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('You have already reported this review');
      }
      throw err;
    }
  }

  /** The owner's own reports, so a report is not a black hole. */
  async myReports(userId: string) {
    const rows = await this.prisma.reviewReport.findMany({
      where: { reportedByUserId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reason: true,
        status: true,
        resolutionNote: true,
        resolvedAt: true,
        createdAt: true,
        rating: { select: { id: true, stars: true, comment: true, commentRemovedAt: true } },
      },
    });
    return rows.map((r) => ({
      ...r,
      rating: {
        id: r.rating.id,
        stars: r.rating.stars,
        // Never echo a removed comment back, not even to the person who
        // successfully had it removed.
        comment: r.rating.commentRemovedAt ? null : r.rating.comment,
        removed: Boolean(r.rating.commentRemovedAt),
      },
    }));
  }

  // ── admin queue ──────────────────────────────────────────────────

  async adminList(status?: string) {
    const valid = ['open', 'upheld', 'dismissed'];
    const where = status && valid.includes(status) ? { status: status as ReviewReportStatus } : {};
    return this.prisma.reviewReport.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      select: {
        id: true,
        reason: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        reportedBy: { select: { id: true, phone: true, email: true } },
        rating: {
          select: {
            id: true,
            stars: true,
            comment: true,
            commentRemovedAt: true,
            createdAt: true,
            raterId: true,
          },
        },
      },
    });
  }

  /**
   * Everything an admin needs to decide, in one call: the comment, who wrote
   * it, and — the part that actually drives the decision — how many strikes
   * that person already has.
   */
  async adminDetail(id: string) {
    const report = await this.prisma.reviewReport.findUnique({
      where: { id },
      select: {
        id: true,
        reason: true,
        status: true,
        resolutionNote: true,
        resolvedAt: true,
        resolvedByAdminId: true,
        createdAt: true,
        reportedBy: { select: { id: true, phone: true, email: true } },
        rating: {
          select: {
            id: true,
            stars: true,
            tags: true,
            comment: true,
            commentRemovedAt: true,
            commentRemovedReason: true,
            createdAt: true,
            raterId: true,
            dealId: true,
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');

    const [author, warnings, priorRemovals] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: report.rating.raterId },
        select: { id: true, phone: true, email: true, status: true, createdAt: true },
      }),
      this.prisma.userWarning.findMany({
        where: { userId: report.rating.raterId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, reason: true, createdAt: true, sourceType: true },
      }),
      this.prisma.rating.count({
        where: { raterId: report.rating.raterId, commentRemovedAt: { not: null } },
      }),
    ]);

    return {
      ...report,
      author,
      warnings,
      warningCount: warnings.length,
      warningsBeforeBan: await this.warningsBeforeBan(),
      priorRemovals,
    };
  }

  /**
   * Decide a report.
   *
   * `remove` strips the comment from public view and optionally warns the
   * author; `dismiss` leaves the review exactly as written. Warning is a
   * separate flag rather than automatic, because a comment can be removed for
   * being off-topic without the author having done anything punishable.
   */
  async decide(
    adminId: string,
    id: string,
    input: { action?: string; note?: string; warn?: boolean },
    ip?: string,
  ) {
    const action = input?.action;
    if (action !== 'remove' && action !== 'dismiss') {
      throw new BadRequestException("action must be 'remove' or 'dismiss'");
    }
    const note = (input?.note ?? '').trim();
    if (action === 'remove' && !note) {
      throw new BadRequestException('A reason is required to remove a comment');
    }

    const report = await this.prisma.reviewReport.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        reportedByUserId: true,
        rating: { select: { id: true, raterId: true, commentRemovedAt: true } },
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'open') throw new BadRequestException('That report is already resolved');

    const authorId = report.rating.raterId;

    if (action === 'dismiss') {
      await this.prisma.reviewReport.update({
        where: { id },
        data: {
          status: 'dismissed',
          resolutionNote: note || null,
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
        },
      });
      await this.audit.log({
        actorId: adminId,
        action: 'review.report.dismissed',
        entityType: 'review_report',
        entityId: id,
        after: { note: note || null },
        ip,
      });
      await this.notify(report.reportedByUserId, 'moderation.report_dismissed', {});
      return { status: 'dismissed' as const, warningCount: null, banned: false };
    }

    // ── remove ───────────────────────────────────────────────────
    await this.prisma.$transaction([
      this.prisma.rating.update({
        where: { id: report.rating.id },
        // The comment text itself is kept — see the schema note; only its
        // visibility changes, so a removal stays reviewable afterwards.
        data: { commentRemovedAt: new Date(), commentRemovedReason: note },
      }),
      this.prisma.reviewReport.update({
        where: { id },
        data: {
          status: 'upheld',
          resolutionNote: note,
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
        },
      }),
      // Any other open report on the same review is now moot.
      this.prisma.reviewReport.updateMany({
        where: { ratingId: report.rating.id, status: 'open', id: { not: id } },
        data: {
          status: 'upheld',
          resolutionNote: note,
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
        },
      }),
    ]);

    await this.audit.log({
      actorId: adminId,
      action: 'review.comment.removed',
      entityType: 'rating',
      entityId: report.rating.id,
      after: { reportId: id, reason: note, warned: Boolean(input?.warn) },
      ip,
    });
    await this.notify(report.reportedByUserId, 'moderation.report_upheld', {});
    await this.notify(authorId, 'moderation.review_removed', { reason: note });

    if (!input?.warn) {
      return { status: 'upheld' as const, warningCount: null, banned: false };
    }
    const escalation = await this.warn(adminId, authorId, note, 'review_report', id, ip);
    return { status: 'upheld' as const, ...escalation };
  }

  /**
   * Issue a strike and close the account if it is the last one.
   *
   * Ban is a side effect of counting, not a separate admin action, so the
   * configured limit cannot be bypassed by an admin forgetting to check.
   */
  async warn(
    adminId: string,
    userId: string,
    reason: string,
    sourceType: string,
    sourceId: string | null,
    ip?: string,
  ): Promise<{ warningCount: number; banned: boolean }> {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestException('A reason is required to warn');

    await this.prisma.userWarning.create({
      data: { userId, issuedByAdminId: adminId, reason: trimmed, sourceType, sourceId },
    });
    const warningCount = await this.prisma.userWarning.count({ where: { userId } });
    const limit = await this.warningsBeforeBan();

    await this.audit.log({
      actorId: adminId,
      action: 'user.warned',
      entityType: 'user',
      entityId: userId,
      after: { reason: trimmed, warningCount, limit, sourceType, sourceId },
      ip,
    });

    if (warningCount < limit) {
      await this.notify(userId, 'moderation.warning', {
        count: warningCount,
        limit,
        reason: trimmed,
      });
      return { warningCount, banned: false };
    }

    const already = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (already?.status !== 'banned') {
      await this.prisma.user.update({ where: { id: userId }, data: { status: 'banned' } });
      // `status` is only checked when a session is created, so without this the
      // banned account keeps working until its access token expires.
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
      const identities = await this.recordBannedIdentities(userId, trimmed);
      await this.audit.log({
        actorId: adminId,
        action: 'user.banned',
        entityType: 'user',
        entityId: userId,
        before: { status: already?.status ?? null },
        after: { status: 'banned', warningCount, limit, reason: trimmed, identitiesRecorded: identities },
        ip,
      });
    }
    // Sent last: in-app still lands, and it is the final thing they see.
    await this.notify(userId, 'moderation.banned', { count: warningCount });
    return { warningCount, banned: true };
  }

  /**
   * Snapshots a banned account's identity documents so the same papers cannot
   * quietly be used to open a new one (§13.2).
   *
   * Hash matching only catches the *same file* being re-uploaded — someone who
   * re-photographs their passport gets a different hash. That is why this feeds
   * the verification queue rather than blocking signup: the durable part of the
   * ban is the admin who looks at the document, and this makes sure they are
   * told. Claiming more than that would be dishonest about what a hash proves.
   */
  async recordBannedIdentities(userId: string, reason?: string): Promise<number> {
    const docs = await this.prisma.document.findMany({
      where: {
        ownerUserId: userId,
        documentType: { in: IDENTITY_DOCUMENT_TYPES },
        deletedAt: null,
      },
      select: { sha256: true, documentType: true },
    });

    let recorded = 0;
    for (const doc of docs) {
      // The unique index does the deduping; a document already on the list
      // (same person banned twice, or a shared file) must not abort the rest.
      try {
        await this.prisma.bannedIdentity.create({
          data: {
            bannedUserId: userId,
            sha256: doc.sha256,
            documentType: doc.documentType,
            reason: reason?.trim() || null,
          },
        });
        recorded++;
      } catch {
        /* already recorded */
      }
    }
    return recorded;
  }

  /**
   * Reinstating an account clears its identity entries. A ban that is lifted
   * but leaves the papers blacklisted would lock the person out through a door
   * nobody remembers locking.
   */
  async clearBannedIdentities(userId: string): Promise<number> {
    const { count } = await this.prisma.bannedIdentity.deleteMany({
      where: { bannedUserId: userId },
    });
    return count;
  }

  /** Identity documents on this list, for the verification queue (§4, §13.2). */
  async bannedIdentityMatches(sha256List: string[]) {
    if (sha256List.length === 0) return [];
    return this.prisma.bannedIdentity.findMany({
      where: { sha256: { in: sha256List } },
      select: { sha256: true, documentType: true, bannedUserId: true, createdAt: true },
    });
  }

  /** Warnings on an account, for the admin user-detail view. */
  warningsFor(userId: string) {
    return this.prisma.userWarning.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, sourceType: true, sourceId: true, createdAt: true },
    });
  }

  /** A moderation notification must never take a decision down with it. */
  private async notify(userId: string, templateKey: string, payload: Record<string, unknown>) {
    try {
      await this.notifications.notify(userId, templateKey, payload);
    } catch {
      /* delivery is best-effort; the decision is already committed */
    }
  }
}
