-- AlterTable
ALTER TABLE "favorites" ADD COLUMN     "last_alert_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "property_price_changes" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "old_amount" DECIMAL(14,2) NOT NULL,
    "new_amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "old_base_gbp" DECIMAL(14,2) NOT NULL,
    "new_base_gbp" DECIMAL(14,2) NOT NULL,
    "change_pct" DECIMAL(6,2) NOT NULL,
    "changed_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_price_changes_property_id_created_at_idx" ON "property_price_changes"("property_id", "created_at");

-- AddForeignKey
ALTER TABLE "property_price_changes" ADD CONSTRAINT "property_price_changes_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
