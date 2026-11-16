-- 0019: LLM spend and per-student daily limits.
--  * llm_calls gets est_cost_usd (estimated from tokens, not a bill) and user_id. Still no prompt or completion column.
--    The monthly spend cap is the sum of est_cost_usd for the current month.
--  * llm_user_daily counts model calls per student per UTC day, for the daily limit.
--  Server-only, like llm_calls: no grant to hirelane_app, no RLS (an RLS table must join the RLS registry).
ALTER TABLE llm_calls
  ADD COLUMN est_cost_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (est_cost_usd >= 0),
  ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX llm_calls_user_at_idx ON llm_calls (user_id, at);

CREATE TABLE llm_user_daily (
  user_id uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date    NOT NULL,
  calls   integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (user_id, day)
);
REVOKE ALL ON llm_user_daily FROM hirelane_app;
