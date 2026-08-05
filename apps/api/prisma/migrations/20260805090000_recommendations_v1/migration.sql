-- Recommendation v1 (Plan §8): co-visitation over property_view_events.

-- Signed-out browsing is the bulk of a portal's traffic, so without a
-- per-browser key co-visitation would only ever see signed-in users.
ALTER TABLE "property_view_events" ADD COLUMN "session_key" TEXT;
CREATE INDEX "property_view_events_session_key_created_at_idx"
    ON "property_view_events"("session_key", "created_at");

-- Materialised nightly: the pairwise scan is far too heavy for a page load,
-- and the result barely moves hour to hour.
CREATE TABLE "property_recommendations" (
    "property_id" TEXT NOT NULL,
    "recommended_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "co_views" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_recommendations_pkey" PRIMARY KEY ("property_id", "recommended_id")
);

CREATE INDEX "property_recommendations_property_id_rank_idx"
    ON "property_recommendations"("property_id", "rank");

ALTER TABLE "property_recommendations" ADD CONSTRAINT "property_recommendations_property_id_fkey"
    FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_recommendations" ADD CONSTRAINT "property_recommendations_recommended_id_fkey"
    FOREIGN KEY ("recommended_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
