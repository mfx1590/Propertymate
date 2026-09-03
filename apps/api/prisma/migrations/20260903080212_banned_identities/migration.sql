-- CreateTable
CREATE TABLE "banned_identities" (
    "id" TEXT NOT NULL,
    "banned_user_id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banned_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banned_identities_sha256_key" ON "banned_identities"("sha256");

-- CreateIndex
CREATE INDEX "banned_identities_banned_user_id_idx" ON "banned_identities"("banned_user_id");

-- AddForeignKey
ALTER TABLE "banned_identities" ADD CONSTRAINT "banned_identities_banned_user_id_fkey" FOREIGN KEY ("banned_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
