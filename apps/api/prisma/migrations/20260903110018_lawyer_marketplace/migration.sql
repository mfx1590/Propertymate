-- CreateEnum
CREATE TYPE "LegalEngagementStatus" AS ENUM ('requested', 'quoted', 'declined', 'accepted', 'withdrawn');

-- CreateTable
CREATE TABLE "lawyer_profiles" (
    "user_id" TEXT NOT NULL,
    "firm_name" TEXT,
    "bar_no" TEXT,
    "bio" TEXT,
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fee_model" TEXT,
    "fee_note" TEXT,

    CONSTRAINT "lawyer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "legal_engagements" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "lawyer_user_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "stage_key" TEXT NOT NULL,
    "status" "LegalEngagementStatus" NOT NULL DEFAULT 'requested',
    "scope" TEXT,
    "quote_amount" DECIMAL(14,2),
    "quote_currency" TEXT,
    "quote_note" TEXT,
    "quoted_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_engagements_lawyer_user_id_status_idx" ON "legal_engagements"("lawyer_user_id", "status");

-- CreateIndex
CREATE INDEX "legal_engagements_deal_id_idx" ON "legal_engagements"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_engagements_deal_id_lawyer_user_id_requested_by_user__key" ON "legal_engagements"("deal_id", "lawyer_user_id", "requested_by_user_id");

-- AddForeignKey
ALTER TABLE "lawyer_profiles" ADD CONSTRAINT "lawyer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_engagements" ADD CONSTRAINT "legal_engagements_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_engagements" ADD CONSTRAINT "legal_engagements_lawyer_user_id_fkey" FOREIGN KEY ("lawyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_engagements" ADD CONSTRAINT "legal_engagements_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
