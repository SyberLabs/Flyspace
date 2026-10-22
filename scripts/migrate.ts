// ============================================
// PROJECT OMNI: MIGRATION RUNNER
//
//     npm run db:migrate
//
// Applies every `db/migrations/*.sql` file in filename order and records
// what ran in `schema_migrations`, so a second run is a no-op. Each file is
// one transaction: a migration that fails halfway leaves nothing behind.
//
// No migration framework. The ledger is two tables; a 60-line runner that
// you can read in full is worth more here than a dependency that hides the
// same loop. Migrations are append-only — fix a mistake with 002, never by
// editing 001.
// ============================================

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

const CREATE_LEDGER_TABLE = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
`;

async function main(): Promise<void> {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
        console.error(
            'DATABASE_URL is not set.\n' +
            'The inference ledger is optional — OmniOS runs without it. To enable it,\n' +
            'set DATABASE_URL in .env (see .env.example) and run this again.'
        );
        process.exit(1);
    }

    const files = (await readdir(MIGRATIONS_DIR))
        .filter(f => f.endsWith('.sql'))
        .sort();

    if (files.length === 0) {
        console.error(`No .sql files in ${MIGRATIONS_DIR}`);
        process.exit(1);
    }

    const pool = new Pool({
        connectionString,
        max: 1,
        ssl: /\bsslmode=verify-(full|ca)\b/.test(connectionString)
            ? { rejectUnauthorized: true }
            : /\bsslmode=require\b/.test(connectionString)
              ? { rejectUnauthorized: false }
              : undefined
    });

    try {
        await pool.query(CREATE_LEDGER_TABLE);
        const applied = await pool.query<{ filename: string }>(
            'SELECT filename FROM schema_migrations'
        );
        const done = new Set(applied.rows.map(r => r.filename));

        let ran = 0;
        for (const filename of files) {
            if (done.has(filename)) {
                console.log(`  skip  ${filename} (already applied)`);
                continue;
            }
            const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1)',
                    [filename]
                );
                await client.query('COMMIT');
                console.log(`  apply ${filename}`);
                ran++;
            } catch (err) {
                await client.query('ROLLBACK').catch(() => { });
                throw new Error(
                    `${filename} failed: ${err instanceof Error ? err.message : String(err)}`
                );
            } finally {
                client.release();
            }
        }
        console.log(ran === 0 ? 'Schema already up to date.' : `Applied ${ran} migration(s).`);
    } finally {
        await pool.end();
    }
}

main().catch((err: unknown) => {
    // The connection string itself must not land in a log or CI transcript.
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
