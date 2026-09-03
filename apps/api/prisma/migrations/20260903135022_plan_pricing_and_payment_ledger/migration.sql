-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('subscription');

-- CreateEnum
CREATE TYPE "PaymentEntryStatus" AS ENUM ('recorded', 'waived', 'reversal');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "interval" TEXT,
ADD COLUMN     "price_amount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "payment_ledger_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'subscription',
    "subscription_id" TEXT,
    "plan_key" TEXT NOT NULL,
    "list_amount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "provider_ref" TEXT,
    "status" "PaymentEntryStatus" NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_by_admin_id" TEXT,
    "reverses_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_ledger_entries_reverses_entry_id_key" ON "payment_ledger_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "payment_ledger_entries_user_id_created_at_idx" ON "payment_ledger_entries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_ledger_entries_subscription_id_idx" ON "payment_ledger_entries"("subscription_id");

-- AddForeignKey
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
