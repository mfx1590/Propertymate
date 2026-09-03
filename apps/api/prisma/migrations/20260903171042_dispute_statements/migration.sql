-- CreateTable
CREATE TABLE "dispute_statements" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "by_admin" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_statements_dispute_id_created_at_idx" ON "dispute_statements"("dispute_id", "created_at");

-- AddForeignKey
ALTER TABLE "dispute_statements" ADD CONSTRAINT "dispute_statements_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
