-- CreateTable
CREATE TABLE "market_snapshots" (
    "id" TEXT NOT NULL,
    "region_id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "sale_count" INTEGER NOT NULL,
    "rent_count" INTEGER NOT NULL,
    "sale_median_gbp" INTEGER,
    "rent_median_gbp" INTEGER,
    "sale_per_m2_gbp" INTEGER,
    "new_listings" INTEGER NOT NULL,
    "price_drops" INTEGER NOT NULL,
    "median_drop_pct" DECIMAL(6,2),
    "views" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_snapshots_region_id_month_key" ON "market_snapshots"("region_id", "month");

-- AddForeignKey
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
