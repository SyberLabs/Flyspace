-- Capability runs are a different payload from inference runs: a manifest
-- digest and an effect, not a prompt. Inference ownership, idempotency, and
-- the uncertain status already live in 003.
CREATE TABLE IF NOT EXISTS capability_execution (
    id                TEXT        PRIMARY KEY,
    capability_id     TEXT        NOT NULL CHECK (length(capability_id) BETWEEN 1 AND 120),
    manifest_digest   TEXT        NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
    effect            TEXT        NOT NULL CHECK (effect IN ('read', 'compute', 'write', 'destructive')),
    input_digest      TEXT        NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
    idempotency_key   TEXT        NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    status            TEXT        NOT NULL CHECK (status IN ('admitted', 'running', 'succeeded', 'failed', 'canceled', 'uncertain')),
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    dispatched_at     TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    error             TEXT,

    CONSTRAINT capability_execution_terminal_shape CHECK (
        (status IN ('admitted', 'running') AND finished_at IS NULL)
        OR (status NOT IN ('admitted', 'running') AND finished_at IS NOT NULL)
    ),
    CONSTRAINT capability_execution_error_shape CHECK (
        status IN ('failed', 'uncertain') OR error IS NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS capability_execution_idempotency_idx
    ON capability_execution (capability_id, idempotency_key);
