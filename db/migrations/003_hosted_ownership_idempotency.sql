-- Hosted identity and request deduplication for the existing Next-owned ledger.
-- Historical/local rows remain ownerless and are never assigned to a new user.
ALTER TABLE inference_run
    ADD COLUMN IF NOT EXISTS owner_id TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS request_digest TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'inference_run_status_check'
           AND pg_get_constraintdef(oid) LIKE '%uncertain%'
    ) THEN
        ALTER TABLE inference_run DROP CONSTRAINT IF EXISTS inference_run_status_check;
        ALTER TABLE inference_run
            ADD CONSTRAINT inference_run_status_check
            CHECK (status IN ('running', 'succeeded', 'failed', 'canceled', 'uncertain'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'inference_run_idempotency_shape'
    ) THEN
        ALTER TABLE inference_run
            ADD CONSTRAINT inference_run_idempotency_shape CHECK (
                (idempotency_key IS NULL AND request_digest IS NULL)
                OR (idempotency_key IS NOT NULL AND request_digest IS NOT NULL)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'inference_run_error_only_on_failure'
           AND pg_get_constraintdef(oid) LIKE '%uncertain%'
    ) THEN
        ALTER TABLE inference_run DROP CONSTRAINT IF EXISTS inference_run_error_only_on_failure;
        ALTER TABLE inference_run
            ADD CONSTRAINT inference_run_error_only_on_failure CHECK (
                status IN ('failed', 'uncertain') OR error IS NULL
            );
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS inference_run_owner_idempotency_idx
    ON inference_run (owner_id, idempotency_key)
    WHERE owner_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS inference_run_owner_started_at_idx
    ON inference_run (owner_id, started_at DESC, id DESC)
    WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inference_run_stale_hosted_idx
    ON inference_run (started_at)
    WHERE status = 'running' AND owner_id IS NOT NULL;
