import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../marketplace/settings.service';
import { SearchService, type SearchParams } from './search.service';
import { parsePolygonParam } from './geo';

/** Ignore rounding-level movements; a 0.2% "drop" is not news (§6.1). */
const DEFAULT_MIN_DROP_PCT = 1;
const MIN_DROP_SETTING = 'alerts.price_drop_min_pct';

/** Guardrail: one sweep should never fan out unboundedly on a bad query. */
const MAX_SAVED_SEARCHES = 5000;
const MAX_FAVORITES = 20000;

/**
 * Saved-search and price-drop alerts (Plan §6.1).
 *
 * Both were specified in Phase 1 and never built: saved searches were stored
 * but nothing ever read them, and favourites had no notion of a price moving.
 * These are the retention half of discovery — the reason a buyer comes back to
 * a property site weeks after their first visit.
 *
 * Deliberately *pull* rather than push: the sweep asks "what is new since I
 * last told this person", instead of every listing publish fanning out to
 * every saved search that might match it. At this catalogue size the nightly
 * pass is cheap, and it cannot storm a user with one alert per new listing.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ── saved searches ───────────────────────────────────────────────

  /**
   * "3 new listings match your Kyrenia search."
   *
   * The window starts at `lastAlertAt`, falling back to when the search was
   * saved — so a search created today never announces the whole back catalogue
   * as though it were new.
   */
  async runSavedSearchAlerts(): Promise<{ checked: number; alerted: number }> {
    const searches = await this.prisma.savedSearch.findMany({
      take: MAX_SAVED_SEARCHES,
      select: {
        id: true,
        name: true,
        query: true,
        lastAlertAt: true,
        createdAt: true,
        userId: true,
        user: { select: { status: true } },
      },
    });

    let alerted = 0;
    const now = new Date();

    for (const s of searches) {
      // A suspended or banned account keeps its data but stops being contacted.
      if (s.user.status !== 'active') continue;

      const since = s.lastAlertAt ?? s.createdAt;
      try {
        const count = await this.search.countMatching({
          ...this.toParams(s.query),
          createdAfterTs: since.getTime(),
        });

        // The cursor advances either way. Without this an empty run would
        // re-scan the same window forever, and the first new listing would be
        // announced against a stale `since`.
        await this.prisma.savedSearch.update({
          where: { id: s.id },
          data: { lastAlertAt: now },
        });

        if (count > 0) {
          await this.notify(s.userId, 'discovery.new_matches', {
            count,
            name: s.name ?? 'your saved search',
          });
          alerted++;
        }
      } catch (err) {
        // One malformed saved query must not abort the sweep for everyone else.
        this.logger.warn(`Saved-search alert failed for ${s.id}: ${err}`);
      }
    }

    return { checked: searches.length, alerted };
  }

  /**
   * Saved queries are free-form JSON written by the web client, so nothing
   * guarantees their shape. Coerce defensively rather than trusting them into
   * a Meilisearch filter.
   */
  private toParams(query: unknown): SearchParams {
    const q = (query ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    return {
      q: str(q.q),
      kind: str(q.kind),
      region: str(q.region),
      minPrice: num(q.minPrice),
      maxPrice: num(q.maxPrice),
      minBeds: num(q.minBeds),
      deedType: str(q.deedType),
      furnished: typeof q.furnished === 'boolean' ? q.furnished : undefined,
      // A search saved with an area drawn must alert on that area only —
      // otherwise the first alert sends the user back to a map showing pins
      // they explicitly excluded. `parsePolygonParam` throws on a malformed
      // string; the caller already treats one bad saved query as skippable
      // rather than fatal to the whole sweep.
      polygon: parsePolygonParam(str(q.polygon)),
    };
  }

  // ── price drops on favourites ────────────────────────────────────

  /**
   * "A property you saved dropped 8%."
   *
   * Reads the price-change log rather than comparing against a remembered
   * price, so a listing that falls twice between sweeps is reported on its
   * true start-to-end movement instead of only the last step.
   */
  async runPriceDropAlerts(): Promise<{ checked: number; alerted: number }> {
    const minDropPct = await this.settings.get(MIN_DROP_SETTING, DEFAULT_MIN_DROP_PCT);
    const favorites = await this.prisma.favorite.findMany({
      take: MAX_FAVORITES,
      select: {
        userId: true,
        propertyId: true,
        createdAt: true,
        lastAlertAt: true,
        user: { select: { status: true } },
        property: {
          select: { id: true, titleI18n: true, status: true, priceBaseGbp: true },
        },
      },
    });

    let alerted = 0;
    const now = new Date();

    for (const fav of favorites) {
      if (fav.user.status !== 'active') continue;
      // A sold or paused listing dropping its price is not an opportunity.
      if (fav.property.status !== 'live') continue;

      const since = fav.lastAlertAt ?? fav.createdAt;
      try {
        const changes = await this.prisma.propertyPriceChange.findMany({
          where: { propertyId: fav.propertyId, createdAt: { gt: since } },
          orderBy: { createdAt: 'asc' },
          select: { oldBaseGbp: true, newBaseGbp: true },
        });
        if (changes.length === 0) continue;

        // Net movement across the whole window, so an up-then-down wobble does
        // not read as a drop, and two consecutive falls report their total.
        const from = Number(changes[0].oldBaseGbp);
        const to = Number(changes[changes.length - 1].newBaseGbp);
        const pct = from > 0 ? ((to - from) / from) * 100 : 0;

        await this.prisma.favorite.update({
          where: { userId_propertyId: { userId: fav.userId, propertyId: fav.propertyId } },
          data: { lastAlertAt: now },
        });

        if (pct <= -minDropPct) {
          await this.notify(fav.userId, 'discovery.price_drop', {
            title: this.title(fav.property.titleI18n),
            pct: Math.abs(Math.round(pct * 10) / 10),
            oldPrice: Math.round(from),
            newPrice: Math.round(to),
          });
          alerted++;
        }
      } catch (err) {
        this.logger.warn(`Price-drop alert failed for ${fav.propertyId}: ${err}`);
      }
    }

    return { checked: favorites.length, alerted };
  }

  private title(map: unknown): string {
    const t = (map ?? {}) as Record<string, string>;
    return t.en || Object.values(t)[0] || 'A saved property';
  }

  /** A failed delivery must not stop the sweep or lose the cursor advance. */
  private async notify(userId: string, templateKey: string, payload: Record<string, unknown>) {
    try {
      await this.notifications.notify(userId, templateKey, payload);
    } catch (err) {
      this.logger.warn(`Alert delivery failed (${templateKey}) for ${userId}: ${err}`);
    }
  }
}
