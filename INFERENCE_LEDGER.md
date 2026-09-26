# The Inference Ledger

A durable server-side record of every LLM execution OmniOS performed.

Two tables in Postgres, joined into a DAG of reasoning so a cascade's full
lineage can be walked. Nothing else moves. The canvas is still local-first.
In local mode Postgres is optional — without `DATABASE_URL`, inference still
runs and the ledger is a no-op. Hosted mode requires a durable ledger before
provider dispatch, so missing or failed admission fails closed.

## Setup

The ledger is off until you give it a database.

```bash
# 1. a database (any Postgres 12+; local, Docker, or hosted)
createdb omni

# 2. point OmniOS at it — .env, server-side only
echo 'DATABASE_URL=postgres://localhost:5432/omni' >> .env

# 3. create the schema
npm run db:migrate
```

That's it. Restart `npm run dev` and every persona turn writes a row when the
database is enabled.

```bash
curl 'http://localhost:3000/api/inference-runs?limit=5'
```

The unauthenticated example is for local loopback mode. Hosted reads require a
verified OIDC bearer token, and hosted inference also requires an owner and an
`Idempotency-Key`.

To turn it off, remove `DATABASE_URL`. Nothing else changes.

`npm run db:migrate` applies every `db/migrations/*.sql` in filename order
and records what ran in `schema_migrations`, so it is safe to re-run. There is
no migration framework: the runner is `scripts/migrate.ts`, sixty lines you
can read in full. Migrations are **append-only** — fix a mistake with `002`,
never by editing `001`.

## Why Postgres here and nowhere else

The dividing line is ownership, not persistence.

**The canvas belongs to the person at the keyboard.** Blocks, wires, shells,
personas, block memory — that state is theirs, it changes on every drag, it
has no meaning to anyone else, and it must survive with no server running at
all. It stays in IndexedDB. Moving it to Postgres would buy nothing and cost
the property the product is built on.

**A run belongs to the server.** The server is the only party that held the
API key, called the provider, and knows how long the provider took. The
browser cannot record an execution honestly: it never saw the key, it cannot
witness a failure that happened after its own tab closed, and its clock is
not the one that measured the latency. Before this, that knowledge existed
only in a `console.error` line.

So the ledger is written at the one boundary where an execution actually
happens — `POST /api/llm` — and read back through `GET /api/inference-runs`
and `GET /api/inference-runs/:id/lineage`.
`DATABASE_URL` is read in exactly one server-only module, the same shape the
provider keys already use: **the browser asks OmniOS, and OmniOS asks the
database.**

Everything else that persists stays where it is. A second store is a second
source of truth, and this one earns its place by holding something the first
one structurally cannot.

## Architecture

```
  browser                          server                        postgres
  ───────                          ──────                        ────────
  persona.engine
    │ sources (provenance)
    ▼
  cognition/kernel ──▶ llm.service ──▶ POST /api/llm
                                          │
                                          ├─ openRun() ─────────▶ INSERT
                                          │                       (status
                                          │                       'running')
                                          ├─ runStream/runComplete
                                          │       │
                                          │       ▼  provider
                                          │
                                          └─ succeeded/failed/
                                             canceled ──────────▶ UPDATE
                                                                  (terminal)

  ApiDashboard? ◀── GET /api/inference-runs             ◀── SELECT (2 stmts)
                ◀── GET /api/inference-runs/:id/lineage ◀── WITH RECURSIVE
```

Files:

| Path | Role |
|------|------|
| `db/migrations/001_inference_ledger.sql` | the two tables |
| `db/migrations/002_run_lineage.sql` | the cascade edge that makes them a DAG |
| `db/migrations/003_hosted_ownership_idempotency.sql` | hosted owner scope, idempotency and uncertain outcomes |
| `src/core/services/server/auth.ts` | hosted OIDC bearer-token verification and owner derivation |
| `scripts/migrate.ts` | the runner (`npm run db:migrate`) |
| `src/core/db/client.ts` | the only place `DATABASE_URL` is read; pool, `query`, `transaction` |
| `src/core/services/server/inference.ledger.ts` | write side and read side |
| `src/app/api/llm/route.ts` | opens and closes a run around the existing call |
| `src/app/api/inference-runs/route.ts` | recent runs |
| `src/app/api/inference-runs/[id]/lineage/route.ts` | the recursive lineage walk |

### Two writes per execution

The row opens **before** the provider is called and closes when the outcome is
known. That is deliberate: an execution the process never came back from
leaves a visible `running` row rather than no trace at all. A `running` row
older than any plausible request is an honest record of a crash, not a bug to
hide.

The closing `UPDATE` carries `WHERE status = 'running'`, so the first terminal
state wins and a stream that both breaks and is cancelled still writes one
outcome.

### Streaming is metered, not buffered

`run.meter(stream)` wraps the provider's `ReadableStream` in one that passes
every chunk straight through and keeps only a running character count and a
bounded head. The client's streaming behaviour is byte-for-byte unchanged.

The wrapper distinguishes normal completion, user cancellation, and ambiguous
transport outcomes:

| ending | status | why |
|--------|--------|-----|
| stream closes | `succeeded` | the provider finished |
| consumer cancels | `canceled` | the user pressed **Stop**; the partial answer is theirs and was kept on the canvas |
| stream transport/body errors | `uncertain` | after dispatch, a connection break does not prove whether the provider completed |
| explicit provider HTTP rejection | `failed` | the provider returned a failure response |

`canceled` is a distinct status because the canvas already treats a stopped
turn as a kept partial rather than an error, and the ledger should not
contradict the UI.

### Provenance

A persona turn already computes which wires and memory pools actually fed it —
that is what the source chips on the canvas point at. Those same
`ContextSource[]` now ride along on the request body (`sources`) purely for
the ledger; they are never sent to a provider and never change the prompt.
Malformed entries are dropped rather than rejected: a bad label must not cost
the user their answer.

The Mind panel's shell-snapshot path and skin generation send no `sources`,
because they have no per-source provenance to report. Their rows have no
source children, which is the truth about them.

### Lineage: the cascade edge

A cascade ("Analyst feeds Strategist") makes one run's *answer* the evidence
for the next. `wire.service` classifies such a source as `kind: 'inference'`,
and `inference_source.parent_run_id` now names the run whose answer was
consumed — so the ledger is a **DAG of reasoning**, not a flat log.

That edge is what makes the product's central claim durable. The canvas answers
"what does this persona know?" one hop deep, with the source chips. In a
three-persona cascade the real grounding is three hops back — and it is
*unrecoverable from the canvas afterwards*, because block data is live and the
upstream evidence has been overwritten by the time you ask. Postgres kept the
snapshot; `WITH RECURSIVE` walks it.

Getting the edge requires the client to know the run id of the answer it just
consumed, which means the id has to come back out of `/api/llm`:

```
POST /api/llm  ->  X-Omni-Run-Id: 42
                     |
                     v
      kernel TurnResult.runId
                     |
                     v
      PersonaChatMessage.runId   (stored on the answer)
                     |
                     v
  aggregateWireContext -> ContextSource.parentRunId
                     |
                     v
      POST /api/llm  ->  inference_source.parent_run_id
```

A **header**, not a body field: the streaming response is plain text, and adding
a field to it would change the stream contract that `llm.service` and the
golden-path e2e depend on. The header is set on both the streaming and
non-streaming paths, and omitted entirely when nothing was recorded.

`wire.service` picks the cited run with `lastPersonaAnswer()` — the same helper
that picks the text actually sent. Sharing it is deliberate: citing run A while
sending answer B would be a provenance lie, which is the one thing this layer
exists to prevent.

## Schema

```
inference_run                         inference_source
─────────────                         ────────────────
id            BIGSERIAL PK   ◀────┐   run_id     BIGINT  ─┐ PK
provider      TEXT   CHECK×3      └── source_id  TEXT    ─┘
model         TEXT                    kind       TEXT  CHECK
streamed      BOOLEAN                 label      TEXT
status        TEXT   CHECK×4          FK → inference_run ON DELETE CASCADE
started_at    TIMESTAMPTZ
finished_at   TIMESTAMPTZ  ─┐
latency_ms    INTEGER       ├─ terminal_shape CHECK
message_count SMALLINT      │
prompt_chars  INTEGER       │
prompt_excerpt TEXT         │
temperature   REAL          │
max_tokens    INTEGER       │
output_chars  INTEGER       │
output_excerpt TEXT         │
tokens_used   INTEGER       │
finish_reason TEXT          │
error         TEXT  ────────┴─ error_only_on_failure CHECK
```

Constraints that carry weight:

- `inference_run_terminal_shape` — a `running` row has no `finished_at` and no
  `latency_ms`; every other status has both. A duration cannot go missing.
- `inference_run_error_only_on_failure` — only `failed` or `uncertain` rows may
  hold an error, so a cancel can never be filed as a failure.
- `provider` / `status` / `kind` `CHECK`s — the enumerations live next to the
  data, not only in TypeScript that a raw `INSERT` bypasses.
- `PRIMARY KEY (run_id, source_id)` on `inference_source` — one run cannot
  cite the same source twice, and it gives the child lookup its index for free.
- `ON DELETE CASCADE` on `run_id` — provenance has no meaning without its run.
- `parent_run_id ... ON DELETE SET NULL` — deleting an *upstream* run must not
  delete the downstream run's record of having consumed something. The edge
  goes unresolved; the fact that a source existed does not.
- `inference_source_parent_only_for_inference` — a market or a memory pool is
  not a run, so only an `inference` source may name a parent.
- `inference_source_no_self_parent` — the one-step cycle is cheap to refuse
  outright. Deeper cycles are handled by the query, below.

Indexes, one per read the API actually performs:

| index | serves |
|-------|--------|
| `inference_run_started_at_idx (started_at DESC, id DESC)` | the default recent-runs page |
| `inference_run_provider_started_at_idx (provider, started_at DESC)` | `?provider=` |
| `inference_run_failed_idx (started_at DESC) WHERE status='failed'` | `?status=failed` — partial, because failures are the minority |
| `inference_source_parent_run_idx (parent_run_id) WHERE NOT NULL` | the child-to-parent join the recursive walk performs every iteration |

### The queries

Open a run (inside a transaction with its sources, so a run's provenance
cannot land half-written):

```sql
INSERT INTO inference_run (
    provider, model, streamed, status,
    message_count, prompt_chars, prompt_excerpt, temperature, max_tokens
) VALUES ($1, $2, $3, 'running', $4, $5, $6, $7, $8)
RETURNING id;

INSERT INTO inference_source (run_id, source_id, kind, label)
VALUES ($1, $2, $3, $4)
ON CONFLICT (run_id, source_id) DO NOTHING;
```

Close it — idempotent by the `status` predicate:

```sql
UPDATE inference_run
   SET status = $2, finished_at = now(), latency_ms = $3,
       output_chars = $4, output_excerpt = $5,
       tokens_used = $6, finish_reason = $7, error = $8
 WHERE id = $1 AND status = 'running';
```

Read recent runs, then their sources in one indexed lookup:

```sql
SELECT ... FROM inference_run
 [WHERE provider = $1 [AND status = $2]]
 ORDER BY started_at DESC, id DESC
 LIMIT $n;

SELECT run_id, source_id, kind, label
  FROM inference_source
 WHERE run_id = ANY($1::bigint[])
 ORDER BY run_id, label;
```

Two statements rather than a JSON aggregate: the run page is already bounded
by `LIMIT`, so the child lookup is one primary-key-prefix scan over a known
small set of ids, and both results stay plainly typed.

Filters are appended as **fixed SQL fragments with bound placeholders**. No
value is ever concatenated into SQL anywhere in this codebase; the driver binds
every parameter. Tests assert that a filter value appears in the bound values
and *not* in the query text.

Walk a run's whole lineage — `GET /api/inference-runs/:id/lineage`:

```sql
WITH RECURSIVE lineage AS (
        SELECT r.id, 0 AS depth, ARRAY[r.id] AS path, false AS is_cycle,
               NULL::bigint AS child_run_id, NULL::text AS via_label
          FROM inference_run r
         WHERE r.id = $1
    UNION ALL
        SELECT parent.id, l.depth + 1, l.path || parent.id,
               parent.id = ANY(l.path), l.id, s.label
          FROM lineage l
          JOIN inference_source s ON s.run_id = l.id
                                 AND s.parent_run_id IS NOT NULL
          JOIN inference_run parent ON parent.id = s.parent_run_id
         WHERE l.depth < $2
           AND NOT l.is_cycle
)
SELECT l.depth, l.is_cycle, l.child_run_id, l.via_label, <run columns>
  FROM lineage l JOIN inference_run ON inference_run.id = l.id
 ORDER BY l.depth, l.id
 LIMIT $3;
```

Three things in there are load-bearing:

- **`path` and `is_cycle`, not the SQL-standard `CYCLE ... SET ... USING`
  clause.** That clause needs Postgres 14; the array costs two extra
  expressions and keeps the documented Postgres 12 floor. A version bump is a
  poor price for syntax sugar. A repeated run is emitted once, marked, and not
  expanded — exactly what `CYCLE` would do. Cycles are real here: nothing stops
  a user wiring two personas to each other, which is why `planCascade` already
  detects and breaks them client-side.
- **`l.depth < $2` as a second, independent bound.** Belt and braces: a
  malformed graph cannot run away even if the path logic were wrong.
- **Qualified columns in the final `SELECT`.** The CTE and `inference_run` both
  have `id`, so an unqualified list is ambiguous. `RUN_COLUMNS_QUALIFIED` is
  derived from the one column list, so the two cannot drift.

`truncated` is reported honestly: true when a node *at the depth limit* still
cites a parent the walk did not follow, not merely when the limit was reached.
A cycle at the limit is reported as a cycle, not as truncation.

## Two rules the write path will not break

**1. Local ledger failures never fail an inference; hosted admission does.**
In local mode every write is wrapped. A dead database costs you a record, not
an answer. `openRun` returns a no-op handle — not `null` — when there is no
database or the `INSERT` failed, and a stream still delivers every byte when a
ledger write throws. Hosted mode checks that admission returned a durable row
before dispatch, so a missing or failed open does not spend provider credits.
A terminal-write failure after a result has been sent cannot undo that result;
the row remains `running` and later hosted ledger activity may mark it
`uncertain`.

A configured-but-unreachable Postgres would otherwise add its connection
timeout to *every* inference, so a failed open pauses the ledger for 30s
(`OPEN_FAILURE_COOLDOWN_MS`). One request pays the timeout; the next half
minute pays nothing; recovery needs no restart.

**2. No credential reaches a row.** Rows are served back to the browser, so
stored text is scrubbed against the server's own env values — provider keys,
data-provider keys, and `DATABASE_URL`, which rides along on `pg` connection
errors. Error text is additionally flattened to one line and capped at 500
characters.

## What a row does *not* hold

- **The full prompt or answer.** `prompt_excerpt` keeps the tail of the final
  user turn (where the task is, after the wired-data context) and
  `output_excerpt` the head of the answer (where the conclusion is), both
  capped at `EXCERPT_LIMIT` (4,000 chars) and marked with an ellipsis so a
  truncation is never mistaken for the whole exchange. The columns are named
  `*_excerpt` for the same reason.
- **A workspace id or session id.** Hosted runs are scoped to the verified
  `iss:sub` owner; local runs remain ownerless. The ledger does not infer a
  workspace/session identity from caller-supplied data. See *Limitations*.
- **Cost.** `tokens_used` is what the provider reported. Pricing is not stored,
  because a price recorded at run time is wrong by the next rate change.

## Tests

| file | what it proves | needs Postgres |
|------|----------------|----------------|
| `src/core/services/server/inference.ledger.test.ts` | local no-op behavior, terminal statuses, stream metering, scrubbing, excerpting, parameter binding | no (mocked driver) |
| `src/core/db/schema.test.ts` | the constraints and indexes the writer relies on are still declared in SQL and all migrations are re-runnable | no |
| `src/core/services/server/inference.ledger.integration.test.ts` | database constraints, owner scope, concurrent idempotency, foreign-owner lineage isolation, and recursive walks | **yes** |

The integration file skips unless `OMNI_TEST_DATABASE_URL` is set, so `npm
test` and the main CI job stay dependency-free:

```bash
OMNI_TEST_DATABASE_URL=postgres://localhost:5432/omni_test npm test
```

It is a **separate variable** on purpose: a suite that truncates tables must
not be able to point at the database a developer is actually using. CI runs it
in its own job against a `postgres:16` service.

## Limitations

- **Local rows have no owner.** Hosted rows use the verified `iss:sub`, but
  browser sign-in/token acquisition and the deployed issuer policy are still
  prerequisites to a usable hosted UI. Ownerless historical rows are not
  reassigned.
- **A crashed hosted process can leave `running` rows until ledger activity.**
  Hosted admission and reads reconcile rows older than three minutes to
  `uncertain`; there is no independent cleanup worker. A timed-out database can
  postpone reconciliation until a later request succeeds.
- **The read API has no pagination.** `limit` is clamped to 200 and there is no
  cursor. `(started_at DESC, id DESC)` is already a stable sort key, so
  keyset pagination drops in when the ledger is big enough to need it.
- **Latency is measured around the whole provider call**, not to first token.
  A streamed row's `latency_ms` is time to *last* byte. Time-to-first-token is
  the more useful number for a streaming UI and is not yet recorded.
- **A cascade that ran before Postgres was configured has no parent edge.**
  `parent_run_id` is nullable for exactly this reason: the upstream answer was
  never recorded, so the honest value is NULL rather than a guess. Lineage stops
  there.
- **Lineage is bounded, not complete.** Depth is clamped to 25 (default 10) and
  the walk to 500 nodes. A wide DAG reached by many paths would materialize the
  same parent once per path inside the CTE before the outer `LIMIT` applies —
  fine for a canvas, where fan-out is the number of persona blocks on screen,
  and worth revisiting if that stops being true.
- **Nothing in the UI reads it yet.** The data is queryable over HTTP; a panel
  on the canvas that shows a persona its own run history — or renders the
  lineage tree behind a source chip — is the obvious next step, and
  deliberately not part of this change.
- **The E2E double writes nothing.** With `OMNI_E2E=1` the route answers before
  the ledger, so the golden-path e2e does not exercise it. The integration job
  covers the real path instead.
