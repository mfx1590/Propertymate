-- Pipeline templates are resolved by key, not by DealKind: a project-unit deal is
-- still kind=purchase but runs the off-plan `project_purchase` stage set (§6.3).
ALTER TABLE "pipeline_templates" ADD COLUMN "key" TEXT;
UPDATE "pipeline_templates" SET "key" = "kind"::text WHERE "key" IS NULL;
ALTER TABLE "pipeline_templates" ALTER COLUMN "key" SET NOT NULL;

DROP INDEX IF EXISTS "pipeline_templates_kind_key";
CREATE UNIQUE INDEX "pipeline_templates_key_key" ON "pipeline_templates"("key");

-- Project inquiry threads (developer leads) live in the existing chat system.
ALTER TABLE "conversations" ADD COLUMN "project_id" TEXT;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
