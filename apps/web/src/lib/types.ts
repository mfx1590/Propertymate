import type { BadgeTier, RoleKey, VerificationStatus } from '@propverify/shared';

export interface MeRole {
  verificationStatus: VerificationStatus;
  badgeTier: BadgeTier;
  role: { key: RoleKey; name: string };
}

export interface Me {
  id: string;
  phone: string | null;
  email: string | null;
  locale: string;
  avatarUrl: string | null;
  status: string;
  userRoles: MeRole[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RequirementConfig {
  documentType: string;
  isRequired: boolean;
  titleI18n: Record<string, string>;
  helpI18n: Record<string, string> | null;
  sortOrder: number;
}
