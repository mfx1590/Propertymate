/** Professional & admin analytics payloads (Plan §6.7, §13.1). */

export type RankingFactorKey = 'rating' | 'deals' | 'responseTime' | 'disputeFree';

export interface RankingBreakdown {
  factors: Record<RankingFactorKey, { value: number | null; score: number; weight: number }>;
  score: number;
  storedScore: number | null;
  computedAt: string | null;
}

export interface AnalyticsFunnel {
  views: number;
  viewsRecent: number;
  inquiries: number;
  viewings: number;
  viewingsCompleted: number;
  offers: number;
  deals: number;
  dealsCompleted: number;
  inquiryRate: number;
  viewingRate: number;
  offerRate: number;
  closeRate: number;
}

export interface ProjectStats {
  projectId: string;
  name: string;
  status: string;
  regionSlug: string;
  units: { total: number; available: number; reserved: number; sold: number };
  absorptionRate: number;
  avgPricePerM2: number | null;
  soldValue: number;
  leads: number;
  updatesPosted: number;
  reservations: number;
}

export interface ComparisonSide {
  projects: number;
  units: number;
  medianPricePerM2: number | null;
  avgAbsorption: number | null;
}

export interface ProjectComparison {
  byRegion: Array<{ regionSlug: string; mine: ComparisonSide; market: ComparisonSide }>;
  overall: { mine: ComparisonSide; market: ComparisonSide };
}

/** `GET /analytics/me` — blocks appear only when the caller has data behind them. */
export interface MyAnalytics {
  scope: { userIds: string[]; isOrg: boolean; windowDays: number };
  listings: Record<string, number>;
  funnel: AnalyticsFunnel;
  deals: { salesClosed: number; rentalsClosed: number };
  reputation: RankingBreakdown | null;
  members?: Array<{
    userId: string;
    phone: string | null;
    orgRole: string;
    rankingScore: number | null;
    ratingAvg: number | null;
    responseTimeAvgSec: number | null;
    salesClosed: number;
    rentalsClosed: number;
    listings: number;
  }>;
  projects?: ProjectStats[];
  comparison?: ProjectComparison;
}

/** The four §6.5 factors, in the order the dashboard renders them. */
export const RANKING_FACTOR_ORDER: RankingFactorKey[] = [
  'rating',
  'deals',
  'responseTime',
  'disputeFree',
];

/** Human-readable factor input; the unit differs per factor. */
export function formatFactorValue(key: RankingFactorKey, value: number | null): string {
  if (value === null) return '—';
  switch (key) {
    case 'rating':
      return `${value.toFixed(1)} ★`;
    case 'deals':
      return String(value);
    case 'responseTime':
      return value < 60 ? `${Math.round(value)}s` : value < 3600 ? `${Math.round(value / 60)}m` : `${Math.round(value / 3600)}h`;
    case 'disputeFree':
      // the API reports the dispute RATE; the row is labelled dispute-free, so
      // a clean record has to read 100%, not 0%
      return `${Math.round((1 - value) * 100)}%`;
  }
}
