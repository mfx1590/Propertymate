import type { BadgeTier } from '@propverify/shared';

const TIER_STYLES: Record<BadgeTier, { bg: string; fg: string; label: string }> = {
  unverified: { bg: '#e5e7eb', fg: '#374151', label: 'Unverified' },
  pending: { bg: '#fef3c7', fg: '#92400e', label: 'Pending' },
  verified: { bg: '#d1fae5', fg: '#065f46', label: 'Verified' },
  trusted_partner: { bg: '#dbeafe', fg: '#1e40af', label: 'Trusted Partner' },
};

export function VerifiedBadge({ tier }: { tier: BadgeTier }) {
  const s = TIER_STYLES[tier];
  return (
    <span
      style={{
        backgroundColor: s.bg,
        color: s.fg,
        borderRadius: 9999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {s.label}
    </span>
  );
}
