-- Agent ranking score (Plan §6.5 / §8): reputation is recomputed nightly and
-- feeds both the find-my-agent directory ordering and the search ranking boost.
-- `response_time_avg_sec` and `deal_count` already existed on this table; only
-- `deal_count`/`rating_avg` were ever written, and response time never was.
ALTER TABLE "agent_profiles" ADD COLUMN "dispute_rate" DOUBLE PRECISION;
ALTER TABLE "agent_profiles" ADD COLUMN "ranking_score" DOUBLE PRECISION;
ALTER TABLE "agent_profiles" ADD COLUMN "ranking_computed_at" TIMESTAMP(3);

-- directory ordering reads this constantly
CREATE INDEX "agent_profiles_ranking_score_idx" ON "agent_profiles"("ranking_score");
