-- Referral system (Plan §8): unique invite codes per user, and the
-- featured-listing credit earned when an invitee publishes a verified listing.

CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'qualified', 'expired');
CREATE TYPE "CreditStatus" AS ENUM ('available', 'used', 'expired');

-- Assigned on first use rather than at signup, so existing accounts get a code
-- the moment they open the referrals page.
ALTER TABLE "users" ADD COLUMN "referral_code" TEXT;
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- A boost only ever reorders LIVE listings — it can never put an unverified
-- one in front of a buyer (§8 "never let paid boosts override verification").
ALTER TABLE "properties" ADD COLUMN "featured_until" TIMESTAMP(3);

-- One row per invitee: a person can be referred once, so a race between two
-- codes resolves to whoever landed first.
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "referee_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "qualified_at" TIMESTAMP(3),
    "qualifying_property_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referrals_referee_id_key" ON "referrals"("referee_id");
CREATE INDEX "referrals_referrer_id_status_idx" ON "referrals"("referrer_id", "status");

ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey"
    FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_fkey"
    FOREIGN KEY ("referee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Earned, not bought: payments are Phase 3, so this is deliberately
-- independent of any billing concept.
CREATE TABLE "featured_credits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'available',
    "source" TEXT NOT NULL DEFAULT 'referral',
    "referral_id" TEXT,
    "used_on_property_id" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_credits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "featured_credits_user_id_status_idx" ON "featured_credits"("user_id", "status");

ALTER TABLE "featured_credits" ADD CONSTRAINT "featured_credits_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
