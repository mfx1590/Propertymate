-- Per-view rows behind the analytics funnel (§6.7) and the future
-- co-visitation recommender (§8). `properties.view_count` remains the
-- lifetime counter; this table makes views a time series.
CREATE TABLE "property_view_events" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "viewer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_view_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "property_view_events_property_id_created_at_idx" ON "property_view_events"("property_id", "created_at");
CREATE INDEX "property_view_events_viewer_id_created_at_idx" ON "property_view_events"("viewer_id", "created_at");

ALTER TABLE "property_view_events" ADD CONSTRAINT "property_view_events_property_id_fkey"
    FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_view_events" ADD CONSTRAINT "property_view_events_viewer_id_fkey"
    FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
