/** Lead inbox (Plan §6.2). */

export const LEAD_STAGES = [
  'new',
  'in_conversation',
  'viewing_booked',
  'viewing_done',
  'offer_made',
  'won',
  'lost',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export interface Lead {
  propertyId: string;
  property: { title: string; status: string; kind: string };
  conversationId: string | null;
  stage: LeadStage;
  /** false until a confirmed viewing or accepted offer (§2.4) */
  contactRevealed: boolean;
  customer: { id: string; phone: string | null; email: string | null; avatarUrl: string | null } | null;
  unread: number;
  lastMessage: { body: string; at: string; fromCustomer: boolean } | null;
  firstResponseSec: number | null;
  awaitingReply: boolean;
  viewings: { id: string; scheduledAt: string; status: string }[];
  offers: { id: string; amount: number; currency: string; status: string; createdAt: string }[];
  dealId: string | null;
  createdAt: string;
  lastActivityAt: string;
}

export interface LeadInbox {
  summary: {
    total: number;
    awaitingReply: number;
    avgFirstResponseSec: number | null;
    byStage: Record<LeadStage, number>;
  };
  listings: { propertyId: string; title: string; status: string; leads: number }[];
  leads: Lead[];
}

export const LEAD_STAGE_STYLES: Record<LeadStage, string> = {
  new: 'bg-sky-50 text-sky-700',
  in_conversation: 'bg-indigo-50 text-indigo-700',
  viewing_booked: 'bg-amber-50 text-amber-700',
  viewing_done: 'bg-amber-50 text-amber-800',
  offer_made: 'bg-violet-50 text-violet-700',
  won: 'bg-emerald-50 text-emerald-700',
  lost: 'bg-gray-100 text-gray-500',
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
