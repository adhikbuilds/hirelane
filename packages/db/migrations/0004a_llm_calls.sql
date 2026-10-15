-- 0004a: LLM call telemetry. Metadata only: there is deliberately no column for prompt or completion text.
CREATE TABLE llm_calls (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose               text        NOT NULL,
  model                 text        NOT NULL,
  mode                  text        NOT NULL CHECK (mode IN ('anthropic', 'fixture')),
  status                text        NOT NULL,
  input_tokens          integer     NOT NULL DEFAULT 0,
  output_tokens         integer     NOT NULL DEFAULT 0,
  cache_read_tokens     integer     NOT NULL DEFAULT 0,
  cache_creation_tokens integer     NOT NULL DEFAULT 0,
  latency_ms            integer     NOT NULL DEFAULT 0,
  batch_size            integer     NOT NULL DEFAULT 1,
  at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_at_idx ON llm_calls (at);
CREATE INDEX llm_calls_purpose_at_idx ON llm_calls (purpose, at);
