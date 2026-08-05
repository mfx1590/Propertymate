-- One visit = one view, enforced by Postgres rather than a read-then-write.
-- The view write is deliberately fire-and-forget (it must never add latency to
-- a public page), so two near-simultaneous requests would both pass a
-- "have we seen this recently?" check. A unique key makes the second insert a
-- no-op instead, and the counter only moves when a row was actually created.
--
-- NULL for visitors with no identity at all: Postgres allows many NULLs in a
-- unique index, so those are simply never deduped.
ALTER TABLE "property_view_events" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "property_view_events_dedupe_key_key" ON "property_view_events"("dedupe_key");
