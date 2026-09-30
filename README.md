# OmniOS

A canvas for thinking with AI over live data. Drop **blocks** that pull real
numbers - prediction markets, economic series, crypto, news, research - wire
them into **personas**, and ask a question that is answered from what the
wires are actually carrying.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without any keys the canvas still runs: every built-in data source is public
(Polymarket, CoinGecko, Hacker News, World Bank, OpenAlex, and others). A persona
needs an LLM - Ollama runs locally with no key.

## The idea

A block is a live view of one source. A wire says *this feeds that*. A persona
is a mind whose entire context is what its incoming wires carry - so the
question "what does this thing actually know?" has a literal answer you can
point at on screen.

Shells are saved canvases. The Shell Store spawns pre-wired ones; the
**Investor** shell arrives with its blocks and wires already connected.

## Configuration

Keys are read **server-side** from `process.env` and are never sent to the
browser. Copy the example and fill in only what you need:

```bash
cp .env.example .env
```

| Variable | Purpose |
|----------|---------|
| `OLLAMA_BASE_URL` | Local LLM (Ollama). Default `http://localhost:11434`. No key. |
| `ANTHROPIC_API_KEY` | Claude for Mind / personas. |
| `GOOGLE_API_KEY` | Gemini for Mind / personas. |
| `DATABASE_URL` | **Optional.** Postgres for the inference ledger. Blank = off. |

### The inference ledger (optional)

Set `DATABASE_URL` and run `npm run db:migrate` to keep a durable server-side
record of every LLM execution - provider, model, status, latency, token
counts, and which wired sources actually fed the turn:

```bash
npm run db:migrate
curl 'http://localhost:3000/api/inference-runs?limit=5'

# everything that made one answer, however many personas deep
curl 'http://localhost:3000/api/inference-runs/42/lineage'
```

When one persona feeds another, the ledger records which *run* was consumed,
not just which block - so the full chain behind a cascade's answer stays
walkable long after the upstream blocks have refetched.

Postgres owns **only** that. The canvas - blocks, wires, shells, personas,
memory - stays in IndexedDB, because it belongs to the person at the keyboard
and must work with no server at all. A run belongs to the server: it is the
only party that held the key, called the provider and timed it. Leave
`DATABASE_URL` blank and the ledger is a no-op. See `INFERENCE_LEDGER.md`.

> **Hosting:** this is local-first and single-user. Keys are shared
> server-side, and there is no application authentication, so a public URL
> would hand every visitor your API credits *and* the prompt and answer
> excerpts in the ledger. The decision on record is that a deployed OmniOS
> goes on a private network (Tailscale / WireGuard / IP allowlist), not a
> public one. The dev and start scripts bind `127.0.0.1`. See
> `DEPLOYMENT.md` for the checklist that has to clear before that changes.

## Development

```bash
npm run typecheck   # tsc, 0 errors
npm run lint        # eslint, 0 errors (warnings are tracked debt)
npm test            # vitest
npm run test:e2e    # playwright golden path (needs npm run build first)
npm run build
npm run scan:bundle # no secret reached .next/static (build first)
```

Node version comes from `.nvmrc`, which CI reads too, so local and CI cannot
drift apart.

CI runs four jobs on every push and pull request:

| Job | What it proves |
|-----|----------------|
| Typecheck, Test & Build | the five checks above, including the Playwright golden path |
| Client bundle carries no secrets | builds with a canary value per secret env var, fails if one reaches `.next/static` |
| Inference Ledger (Postgres) | migrations apply and re-apply against a real `postgres:16`; constraints, foreign keys and the recursive lineage walk execute |
| Dependency audit | production deps block on `high`; dev-only advisories are advisory |

`npm run scan:bundle` is the interesting one - it is the check that used to be
a grep someone had to remember. See `DEPLOYMENT.md`.

The ledger's Postgres-backed tests are skipped unless you give them a scratch
database of their own. They `TRUNCATE`, so never point this at the database in
your `.env`:

```bash
OMNI_TEST_DATABASE_URL=postgres://localhost:5432/omni_test npm test
```

## Not in this repo

- **The agent surface** - keyless local browser automation, `/surface` and
  `/api/agent` - moved to
  [SyberLabs/omni-agent](https://github.com/SyberLabs/omni-agent) on
  2026-09-01. It shared no module with the canvas.
- **The Garden and the life OS** - `/garden`, life-system domains, stability
  and equilibrium modelling - deleted on 2026-09-01. It was a second product
  in the same repo, ~15k lines whose value was gated on history that was
  never built. See `APEX_PLAN.md` §5.

The canvas is the product.

## Docs

`APEX_PLAN.md` is the live roadmap. `vision.md` is the north star.
`WIRE_SYSTEM_GUIDE.md`, `TYPED_PORT_SYSTEM.md` (display-only port metadata), and
`MEMORY_ARCHITECTURE.md` cover the wire, port, and memory layers.
`INFERENCE_LEDGER.md` covers the one thing Postgres owns, and why the rest stays
local. `DEPLOYMENT.md` records the hosting decision and what CI guarantees.
