-- Platform-generated contracts + typed e-sign (Plan §7 rental template,
-- §6.2 "simple typed-signature + audit trail at launch").
--
-- The PDF itself is an ordinary `documents` row, so it inherits the private
-- bucket and signed-URL rules (§2.4) rather than inventing a second store.

CREATE TYPE "ContractKind" AS ENUM ('rental_tenancy', 'agent_mandate');
CREATE TYPE "ContractStatus" AS ENUM ('awaiting_signatures', 'signed', 'void');

CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "kind" "ContractKind" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'awaiting_signatures',
    "deal_id" TEXT,
    "property_id" TEXT,
    "document_id" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_at" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contracts_document_id_key" ON "contracts"("document_id");
CREATE INDEX "contracts_deal_id_idx" ON "contracts"("deal_id");

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One row per required signatory; signed_at NULL means outstanding.
CREATE TABLE "contract_signatures" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "party_role" TEXT NOT NULL,
    "typed_name" TEXT,
    "signed_at" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_signatures_contract_id_user_id_key"
    ON "contract_signatures"("contract_id", "user_id");

ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
