-- AlterTable
ALTER TABLE "banned_identities" ADD COLUMN     "doc_number_hash" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "doc_number" TEXT,
ADD COLUMN     "doc_number_hash" TEXT;

-- CreateIndex
CREATE INDEX "banned_identities_doc_number_hash_idx" ON "banned_identities"("doc_number_hash");

-- CreateIndex
CREATE INDEX "documents_doc_number_hash_idx" ON "documents"("doc_number_hash");
