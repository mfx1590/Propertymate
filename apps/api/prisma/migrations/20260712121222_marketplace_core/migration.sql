-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('invited', 'accepted', 'rejected', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'cancelled', 'expired');

-- AlterEnum
ALTER TYPE "PropertyStatus" ADD VALUE 'verified_private';

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "agent_commission_gbp" DECIMAL(14,2),
ADD COLUMN     "list_price_gbp" DECIMAL(14,2),
ADD COLUMN     "platform_profit_gbp" DECIMAL(14,2),
ADD COLUMN     "published_by_agent_id" TEXT;

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "profit_bands" (
    "id" TEXT NOT NULL,
    "min_price_gbp" DECIMAL(14,2) NOT NULL,
    "max_price_gbp" DECIMAL(14,2) NOT NULL,
    "profit_gbp" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "profit_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "granted_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_assignments" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "agent_user_id" TEXT NOT NULL,
    "term_months" INTEGER NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'invited',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "agent_assignments_agent_user_id_status_idx" ON "agent_assignments"("agent_user_id", "status");

-- CreateIndex
CREATE INDEX "agent_assignments_property_id_status_idx" ON "agent_assignments"("property_id", "status");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
