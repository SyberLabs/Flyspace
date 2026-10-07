# The Inference Ledger

A durable server-side record of every LLM execution OmniOS performed.

Two tables in Postgres, `inference_run` and `inference_source`, joined into a
DAG of reasoning so a cascade's full lineage can be walked. One more table,
`capability_execution` (`db/migrations/004_capability_execution.sql`), holds
the capability broker's execution rows: a manifest digest, an effect and a
status, not a prompt. Nothing else moves. The canvas is still local-first.
In local mode Postgres is optional — without `DATABASE_URL`, inference still
runs and the ledger is a no-op. Hosted mode requires a durable ledger before
provider dispatch, so missing or failed admission fails closed.

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

### What `streamed` means

`streamed` is true only when the provider's bytes passed through to the client
as they arrived. It is not a copy of the request's `stream` flag. Today only
the local provider (Ollama) streams. The Anthropic and Google adapters have no
streaming path: a `stream: true` request to them completes the whole answer and
hands it over as one chunk, and the row records `streamed: false`. The route
asks the adapter module (`providerStreams`) rather than guessing. Real
streaming for those providers is a separate package; when it lands, flipping
that one function makes their rows true.

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

The Mind panel's shell-snapshot path sends no `sources`, because it has no
per-source provenance to report. Its rows have no source children, which is the
truth about it.

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
  outright. Deeper cycles are handled by the lineage query in
  `inference.ledger.ts`.

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
  A streamed row's `latency_ms` is time to *last* byte; a buffered row's is the
  whole call, since there was no earlier byte. Time-to-first-token is the more
  useful number for a streaming UI and is not yet recorded.
- **A cascade that ran before Postgres was configured has no parent edge.**
  `parent_run_id` is nullable for exactly this reason: the upstream answer was
  never recorded, so the honest value is NULL rather than a guess. Lineage stops
  there.
- **Lineage is bounded, not complete.** Depth is clamped to 25 (default 10) and
  the walk to 500 nodes. A wide DAG reached by many paths would materialize the
  same parent once per path inside the CTE before the outer `LIMIT` applies —
  fine for a canvas, where fan-out is the number of persona blocks on screen,
  and worth revisiting if that stops being true.
- **The UI reads lineage only.** A persona answer that carries a run id shows a
  **Lineage** toggle (`src/blocks/persona/RunLineage.tsx`) that renders
  `GET /api/inference-runs/:id/lineage` as a tree: each upstream run, the chip
  it was cited under, and its sources. With no ledger, a public demo, a failed
  query, or a hosted deployment with no browser sign-in it says so instead of
  drawing anything. No panel lists a persona's run history yet.
- **The E2E double writes nothing.** With `OMNI_E2E=1` the route answers before
  the ledger, so the golden-path e2e does not exercise it. The integration job
  covers the real path instead.
