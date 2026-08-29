-- CreateEnum
CREATE TYPE "ReviewReportStatus" AS ENUM ('open', 'upheld', 'dismissed');

-- AlterTable
ALTER TABLE "ratings" ADD COLUMN     "comment_removed_at" TIMESTAMP(3),
ADD COLUMN     "comment_removed_reason" TEXT;

-- CreateTable
CREATE TABLE "review_reports" (
    "id" TEXT NOT NULL,
    "rating_id" TEXT NOT NULL,
    "reported_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReviewReportStatus" NOT NULL DEFAULT 'open',
    "resolution_note" TEXT,
    "resolved_by_admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_warnings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "issued_by_admin_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'review_report',
    "source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_reports_status_idx" ON "review_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_rating_id_reported_by_user_id_key" ON "review_reports"("rating_id", "reported_by_user_id");

-- CreateIndex
CREATE INDEX "user_warnings_user_id_idx" ON "user_warnings"("user_id");

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_rating_id_fkey" FOREIGN KEY ("rating_id") REFERENCES "ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
