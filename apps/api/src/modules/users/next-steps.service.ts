import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../marketplace/subscriptions.service';

/**
 * `todo`    — the user can act right now
 * `waiting` — the platform or a counterparty owes them something
 * `done`    — kept so the checklist shows progress, not just what is missing
 */
export type StepState = 'todo' | 'waiting' | 'done';

export interface NextStep {
  key: string;
  state: StepState;
  /** where the action lives; absent when there is nothing for them to click */
  href?: string;
  /** interpolated into the copy — a count, a listing title */
  params?: Record<string, string | number>;
}

/**
 * "What do I do next?" (the single most common question a new account has).
 *
 * Computed on the server on purpose: the answer depends on role, verification,
 * subscription and listing state at once, and duplicating that logic in the web
 * app would guarantee the two drift. The client only renders copy for a key.
 *
 * Order matters — the first `todo` is the primary call to action, so the rules
 * are listed in the order a real account actually progresses through them.
 */
@Injectable()
export class NextStepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async forUser(userId: string): Promise<{ steps: NextStep[]; primary: string | null }> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId },
      select: { verificationStatus: true, role: { select: { key: true } } },
    });
    const roleKeys = new Set(roles.map((r) => r.role.key));
    const has = (...keys: string[]) => keys.some((k) => roleKeys.has(k));

    const canList = has('owner', 'solo_agent', 'agency', 'agency_member');
    const isPro = has('solo_agent', 'agency', 'agency_member', 'developer');
    const steps: NextStep[] = [];

    // ── 1. get the professional role verified ─────────────────────
    if (isPro) {
      const pro = roles.find((r) =>
        ['solo_agent', 'agency', 'agency_member', 'developer'].includes(r.role.key),
      );
      if (pro && pro.verificationStatus !== 'verified') {
        steps.push({
          key: pro.verificationStatus === 'pending' ? 'verification_pending' : 'verify_profile',
          state: pro.verificationStatus === 'pending' ? 'waiting' : 'todo',
          href: '/dashboard',
          params: { role: pro.role.key },
        });
      } else if (pro) {
        steps.push({ key: 'verify_profile', state: 'done' });
      }
    }

    // ── 2. listing/project creation is subscription-gated (§13.3) ──
    if (canList || has('developer')) {
      const active = await this.subscriptions.hasActive(userId).catch(() => false);
      steps.push({
        key: 'subscription',
        state: active ? 'done' : 'todo',
        // granted by an admin until Phase 3 payments, so there is nowhere to
        // send them — the copy explains that rather than dangling a dead link
      });
    }

    // ── 3–6. the listing pipeline ─────────────────────────────────
    if (canList) {
      const listings = await this.prisma.property.findMany({
        where: { deletedAt: null, OR: [{ createdByUserId: userId }, { publishedByAgentId: userId }] },
        select: { id: true, status: true, titleI18n: true },
      });
      const byStatus = (s: string) => listings.filter((l) => l.status === s);

      steps.push({
        key: 'create_listing',
        state: listings.length > 0 ? 'done' : 'todo',
        href: '/dashboard/listings/new',
      });

      const drafts = byStatus('draft');
      if (drafts.length > 0) {
        steps.push({
          key: 'submit_listing',
          state: 'todo',
          href: '/dashboard/listings',
          params: { count: drafts.length },
        });
      }

      const pending = byStatus('pending_verification');
      if (pending.length > 0) {
        steps.push({
          key: 'awaiting_verification',
          state: 'waiting',
          href: '/dashboard/listings',
          params: { count: pending.length },
        });
      }

      // The one that confuses everybody: a verified resale is deliberately NOT
      // public (§13.4). Without this step the owner sees "verified" and then
      // wonders why nobody can find it.
      const priv = byStatus('verified_private');
      if (priv.length > 0) {
        steps.push({
          key: 'choose_agents',
          state: 'todo',
          href: `/dashboard/listings/${priv[0].id}/find-agent`,
          params: {
            count: priv.length,
            title: (priv[0].titleI18n as { en?: string })?.en ?? '',
          },
        });
      }

      if (byStatus('live').length > 0) {
        steps.push({ key: 'listing_live', state: 'done', href: '/dashboard/listings' });
      }
    }

    // ── 7. an agent with mandates waiting on them ─────────────────
    if (has('solo_agent', 'agency', 'agency_member')) {
      const invited = await this.prisma.agentAssignment.count({
        where: { agentUserId: userId, status: 'invited', expiresAt: { gt: new Date() } },
      });
      if (invited > 0) {
        steps.push({
          key: 'respond_mandates',
          state: 'todo',
          href: '/dashboard/mandates',
          params: { count: invited },
        });
      }
    }

    // ── 8. developer projects ─────────────────────────────────────
    if (has('developer')) {
      const projects = await this.prisma.project.count({
        where: { developerUserId: userId, deletedAt: null },
      });
      steps.push({
        key: 'create_project',
        state: projects > 0 ? 'done' : 'todo',
        href: '/dashboard/projects/new',
      });
    }

    // ── 9. unanswered leads ───────────────────────────────────────
    if (canList || has('developer')) {
      const unanswered = await this.unansweredLeadCount(userId);
      if (unanswered > 0) {
        steps.push({
          key: 'answer_leads',
          state: 'todo',
          href: '/dashboard/leads',
          params: { count: unanswered },
        });
      }
    }

    // ── 10. a plain customer has a different journey entirely ─────
    if (!canList && !has('developer')) {
      const [favourites, viewings] = await Promise.all([
        this.prisma.favorite.count({ where: { userId } }),
        this.prisma.viewing.count({ where: { customerId: userId } }),
      ]);
      steps.push({ key: 'browse_listings', state: favourites > 0 ? 'done' : 'todo', href: '/search' });
      steps.push({ key: 'save_favourites', state: favourites > 0 ? 'done' : 'todo', href: '/search' });
      steps.push({
        key: 'book_viewing',
        state: viewings > 0 ? 'done' : 'todo',
        href: viewings > 0 ? '/dashboard/viewings' : '/search',
      });
    }

    return {
      steps,
      primary: steps.find((s) => s.state === 'todo')?.key ?? null,
    };
  }

  /** Conversations from a customer on the caller's listings with no reply yet. */
  private async unansweredLeadCount(userId: string): Promise<number> {
    const propertyIds = (
      await this.prisma.property.findMany({
        where: { deletedAt: null, OR: [{ createdByUserId: userId }, { publishedByAgentId: userId }] },
        select: { id: true },
      })
    ).map((p) => p.id);
    if (propertyIds.length === 0) return 0;

    const conversations = await this.prisma.conversation.findMany({
      where: {
        propertyId: { in: propertyIds },
        dealId: null,
        participants: { some: { roleInConvo: 'customer' } },
      },
      select: { messages: { select: { senderId: true } } },
    });
    return conversations.filter(
      (c) => c.messages.length > 0 && !c.messages.some((m) => m.senderId === userId),
    ).length;
  }
}
