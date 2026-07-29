-- Org membership gains a role so an agency can delegate team management (§13.1).
-- `agency_agents` already existed but was never written to by application code.
ALTER TABLE "agency_agents" ADD COLUMN "org_role" TEXT NOT NULL DEFAULT 'member';
