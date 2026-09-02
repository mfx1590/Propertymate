-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "assignment_id" TEXT;

-- CreateIndex
CREATE INDEX "contracts_assignment_id_idx" ON "contracts"("assignment_id");
