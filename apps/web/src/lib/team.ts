/** Agency organizations (Plan §13.1–13.2). */

export type OrgRole = 'org_admin' | 'member';
export type MemberStatus = 'active' | 'deactivated';

/** `GET /agency/members` — org-admin view, includes contact details. */
export interface TeamMember {
  userId: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  regions: string[];
  ratingAvg: number | null;
  orgRole: OrgRole;
  status: MemberStatus;
  joinedAt: string;
  salesClosed: number;
  rentalsClosed: number;
}

/** `GET /agencies/:id` — public payload; no phones, emails or org roles. */
export interface PublicAgency {
  userId: string;
  companyName: string;
  about: string | null;
  address: string | null;
  logoUrl: string | null;
  avatarUrl: string | null;
  badgeTier: string;
  verified: boolean;
  members: Array<{
    userId: string;
    avatarUrl: string | null;
    bio: string | null;
    regions: string[];
    ratingAvg: number | null;
    salesClosed: number;
    rentalsClosed: number;
    joinedAt: string;
  }>;
  totals: { members: number; salesClosed: number; rentalsClosed: number };
}

export const MEMBER_STATUS_STYLES: Record<MemberStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  deactivated: 'bg-gray-100 text-gray-500',
};
