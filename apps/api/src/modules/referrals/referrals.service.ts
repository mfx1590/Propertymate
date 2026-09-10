import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../marketplace/settings.service';

/** Unambiguous alphabet — no 0/O, 1/I/L: these codes get read aloud and retyped. */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789';
const CODE_LENGTH = 8;

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * The caller's own code, minted on first read.
   *
   * Assigned lazily rather than at signup so every existing account — and every
   * account created by an agency adding a member — gets one without a backfill.
   */
  async myCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (user.referralCode) return user.referralCode;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.generateCode();
      try {
        await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
        return code;
      } catch {
        // unique collision — vanishingly unlikely, but retry rather than 500
      }
    }
    throw new BadRequestException('Could not allocate a referral code, please retry');
  }

  private generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  /**
   * Records that a brand-new account arrived on someone's code.
   *
   * Called from the signup paths and deliberately never throws: a mistyped or
   * stale code must not stop someone creating an account.
   */
  async attachOnSignup(refereeId: string, rawCode: string | undefined, ip?: string) {
    const code = rawCode?.trim().toUpperCase();
    if (!code) return;

    try {
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!referrer || referrer.id === refereeId) return; // unknown code, or self-referral

      await this.prisma.referral.create({
        data: { referrerId: referrer.id, refereeId, code },
      });
      await this.audit.log({
        actorId: refereeId,
        action: 'referral.attached',
        entityType: 'referral',
        entityId: refereeId,
        after: { referrerId: referrer.id, code },
        ip,
      });
    } catch (err) {
      // already referred, or a race — the first attribution stands
      this.logger.debug(`Referral attach skipped for ${refereeId}: ${err}`);
    }
  }

  /**
   * §8 qualifying event: the invitee published a verified listing.
   *
   * Listens for `listing.live` so nothing in the properties or verification
   * modules needs to know referrals exist. Verification is what makes the
   * reward meaningful — a draft listing earns nothing.
   */
  @OnEvent('listing.live')
  async onListingLive({ propertyId }: { propertyId: string }) {
    try {
      const property = await this.prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true, createdByUserId: true, publishedByAgentId: true },
      });
      if (!property) return;

      // credit the person whose listing it is, not the agent who published it
      const referral = await this.prisma.referral.findUnique({
        where: { refereeId: property.createdByUserId },
      });
      if (!referral || referral.status !== 'pending') return;

      const expiryDays = await this.settings.get('referral.credit_expiry_days');

      await this.prisma.$transaction([
        this.prisma.referral.update({
          where: { id: referral.id },
          data: {
            status: 'qualified',
            qualifiedAt: new Date(),
            qualifyingPropertyId: property.id,
          },
        }),
        this.prisma.featuredCredit.create({
          data: {
            userId: referral.referrerId,
            source: 'referral',
            referralId: referral.id,
            expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
          },
        }),
      ]);

      await this.notifications.notify(referral.referrerId, 'assignment.published', {
        propertyId: property.id,
        title: 'your referral earned a featured-listing credit',
      });
      await this.audit.log({
        actorId: referral.refereeId,
        action: 'referral.qualified',
        entityType: 'referral',
        entityId: referral.id,
        after: { referrerId: referral.referrerId, propertyId: property.id },
      });
      this.logger.log(`Referral ${referral.id} qualified — credit issued to ${referral.referrerId}`);
    } catch (err) {
      // a rewards failure must never break publishing a listing
      this.logger.error(`Referral qualification failed for ${propertyId}: ${err}`);
    }
  }

  /** The caller's referral dashboard: code, invitees and credit balance. */
  async overview(userId: string) {
    const code = await this.myCode(userId);
    const [referrals, credits] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, createdAt: true, qualifiedAt: true },
      }),
      this.prisma.featuredCredit.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, source: true, expiresAt: true,
          usedOnPropertyId: true, usedAt: true, createdAt: true,
        },
      }),
    ]);

    return {
      code,
      // Invitee identities are deliberately absent: knowing that someone you
      // invited has signed up is enough, and publishing who they are would leak
      // a stranger's account existence to whoever guessed their interest.
      referrals: referrals.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        qualifiedAt: r.qualifiedAt,
      })),
      summary: {
        invited: referrals.length,
        qualified: referrals.filter((r) => r.status === 'qualified').length,
        creditsAvailable: credits.filter((c) => c.status === 'available').length,
        creditsUsed: credits.filter((c) => c.status === 'used').length,
      },
      credits,
    };
  }

  /**
   * Spends a credit to feature a listing (§8 reward, §9 `featured_slots` seam).
   *
   * Only a LIVE listing can be featured: a boost reorders verified supply, it
   * never gets an unverified listing in front of a buyer.
   */
  async featureListing(userId: string, propertyId: string, ip?: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, status: true, createdByUserId: true, publishedByAgentId: true, featuredUntil: true },
    });
    if (!property) throw new NotFoundException('Listing not found');

    const isLister =
      property.createdByUserId === userId || property.publishedByAgentId === userId;
    if (!isLister) throw new BadRequestException('Not your listing');
    if (property.status !== 'live') {
      throw new BadRequestException('Only a live listing can be featured');
    }
    if (property.featuredUntil && property.featuredUntil > new Date()) {
      throw new BadRequestException('This listing is already featured');
    }

    const credit = await this.prisma.featuredCredit.findFirst({
      where: {
        userId,
        status: 'available',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { expiresAt: 'asc' }, // spend the one closest to expiring
    });
    if (!credit) throw new BadRequestException('You have no available featured credits');

    const days = await this.settings.get('referral.featured_days');
    const featuredUntil = new Date(Date.now() + days * 86_400_000);

    await this.prisma.$transaction([
      this.prisma.featuredCredit.update({
        where: { id: credit.id },
        data: { status: 'used', usedAt: new Date(), usedOnPropertyId: propertyId },
      }),
      this.prisma.property.update({ where: { id: propertyId }, data: { featuredUntil } }),
    ]);

    await this.audit.log({
      actorId: userId,
      action: 'listing.featured',
      entityType: 'property',
      entityId: propertyId,
      after: { featuredUntil, creditId: credit.id },
      ip,
    });

    // search owns the index; it re-syncs on this event and picks up the boost
    this.events.emit('listing.updated', { propertyId });

    return { propertyId, featuredUntil, creditsRemaining: await this.availableCredits(userId) };
  }

  private async availableCredits(userId: string) {
    return this.prisma.featuredCredit.count({
      where: {
        userId,
        status: 'available',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  /**
   * Nightly: expire credits nobody spent, and stop featuring listings whose
   * window has closed so the search index can drop the boost.
   */
  async expireSweep(): Promise<{ credits: number; listings: number }> {
    const now = new Date();
    const { count: credits } = await this.prisma.featuredCredit.updateMany({
      where: { status: 'available', expiresAt: { lt: now } },
      data: { status: 'expired' },
    });
    const stale = await this.prisma.property.findMany({
      where: { featuredUntil: { lt: now } },
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.property.updateMany({
        where: { id: { in: stale.map((p) => p.id) } },
        data: { featuredUntil: null },
      });
      // drop the boost from the index too, or a lapsed listing keeps its place
      for (const p of stale) this.events.emit('listing.updated', { propertyId: p.id });
    }
    return { credits, listings: stale.length };
  }
}
