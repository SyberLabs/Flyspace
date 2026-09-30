-- Async capability runs: start returns an external run id and later polls
-- observe it. The row keeps which provider admitted the capability, the
-- external id reconciliation queries, and what the destination last said.
-- Existing rows are synchronous and keep their meaning.
ALTER TABLE capability_execution
    ADD COLUMN IF NOT EXISTS provider_id TEXT,
    ADD COLUMN IF NOT EXISTS execution_profile TEXT NOT NULL DEFAULT 'sync',
    ADD COLUMN IF NOT EXISTS external_run_id TEXT,
    ADD COLUMN IF NOT EXISTS last_observed_status TEXT,
    ADD COLUMN IF NOT EXISTS last_observed_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'capability_execution_profile_check'
    ) THEN
        ALTER TABLE capability_execution
            ADD CONSTRAINT capability_execution_profile_check
            CHECK (execution_profile IN ('sync', 'async_poll'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'capability_execution_observed_check'
    ) THEN
        ALTER TABLE capability_execution
            ADD CONSTRAINT capability_execution_observed_check
            CHECK (last_observed_status IS NULL OR last_observed_status IN ('accepted', 'running', 'succeeded', 'failed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'capability_execution_external_run_shape'
    ) THEN
        ALTER TABLE capability_execution
            ADD CONSTRAINT capability_execution_external_run_shape CHECK (
                external_run_id IS NULL
                OR (execution_profile = 'async_poll' AND external_run_id ~ '^[A-Za-z0-9._:-]{1,128}$')
            );
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS capability_execution_open_async_idx
    ON capability_execution (started_at)
    WHERE execution_profile = 'async_poll' AND status IN ('running', 'uncertain');
