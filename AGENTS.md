# AGENTS.md

Rules for agents (and people) changing OmniOS. Read `README.md` first,
`APEX_PLAN.md` for the live roadmap. Root plan documents with a "Status ...
historical" banner are a record, not a spec.

## The product

- **The canvas is the product.** Blocks pull live data, wires say what feeds what,
  personas answer from what their wires carry.
- **A persona's context is its inbound wires.** Nothing else may enter a persona
  turn silently. If a source informed an answer, the user can point at the wire.
- **No second product surface.** The agent surface moved to `SyberLabs/omni-agent`
  and the Garden was deleted (2026-09-01). Do not add a parallel app to this repo.
- Local-first and single-user. LLM and built-in data-provider keys are read
  server-side from `process.env`. A credential you enter for a compiled API lives
  in browser memory for the session only (`src/core/capabilities/secrets.ts`), is
  never persisted, and is attached to the capability's own request. A deployed
  instance goes on a private network (`DEPLOYMENT.md`).

## Authority boundaries

- **IndexedDB owns the canvas** (blocks, wires, shells, personas, memory) through
  `src/core/vault/`. **Postgres owns only server-side run records**: inference
  runs (`INFERENCE_LEDGER.md`) and the capability broker's execution rows
  (`db/migrations/004_capability_execution.sql`). Do not move canvas state to a
  server, and do not put canvas state in Postgres.
- **A manifest never grants itself authority.** Compilers only propose a
  `CapabilityManifest`. `installProposal` registers it, write and destructive
  effects need `approveCapability`, and `executeCapability` is the one runtime.
  Approval is not part of the manifest digest. See `src/core/capabilities/DESIGN.md`.
- **Spoken and pointer input only propose commands.** The interaction
  engine (`src/core/interaction/engine.ts`) admits them. Adapters never call the
  canvas stores directly. Unknown or ambiguous input is refused, a delete previews
  until confirmed, and a committed command can be undone.
- **Wires are admitted, not drawn.** Every product path creates a wire through
  `wireStore.addWire` (or `replaceWiresForShell` on restore), which calls
  `admitConnection`. See `TYPED_PORT_SYSTEM.md`.
- **Secrets stay on the server.** `npm run scan:bundle` must pass.

## Before opening a PR

Run all of these; each is a script in `package.json`. Node comes from `.nvmrc`.

```bash
npm run typecheck    # tsc --noEmit, 0 errors
npm run lint         # eslint, 0 errors (warnings are tracked debt)
npm test             # vitest
npm run build        # next build
npm run scan:bundle  # no secret reached .next/static (needs build first)
npm run test:e2e     # playwright golden path (needs build first)
```

Postgres-backed tests are skipped unless `OMNI_TEST_DATABASE_URL` points at a
scratch database. They `TRUNCATE`, so never use the database in `.env`.
Docs-only changes still run the checks that a docs edit can break (at least
`typecheck` and `lint`), and every path or script a doc names must exist.

## Work packages

- **One work package = one branch = one PR.** Branch `wp/omni/<slug>`. Do not
  bundle unrelated changes, and do not merge your own PR.
- Do not edit files that another open work package owns. If two packages touch
  `APEX_PLAN.md` or `FINDINGS.md`, sequence them.
- A PR body states: objective, what changed, what did not, tests run,
  measurements, known failures, claim ceiling, architectural decisions
  introduced, evidence that could falsify it, next permissible package.

## Stop conditions

Stop and ask the owner instead of proceeding when a change would:

1. **Let model output mutate canvas state without the interaction engine's
   admission.** LLM text, a persona answer, or a compiled manifest must not add,
   move, delete, or wire blocks on its own.
2. **Cite a source that carried no data.** An empty array or an empty Memory pool
   must produce no source chip (`FINDINGS.md`).
3. **Add new write-effect capability surface** (a new path that can run POST, PUT,
   PATCH, or DELETE, or a new way to approve one) without an explicit product need.
   This surface is frozen on the SyberLabs MasterMind 2026-09-29 recommendation,
   pending an owner decision.
4. Put a secret, or a value derived from one, into `.next/static`, a log, or the
   inference ledger.
5. Make the app public-facing without the checklist in `DEPLOYMENT.md`.

## Claim discipline

Use one word per level and do not promote a claim past the evidence you have.

| Word | Means |
| --- | --- |
| implemented | the code path exists |
| tested | an automated test exercises it (say: fixtures, stubs, or real services) |
| measured | a number was recorded from a real run, with the method |
| deployed | it runs in a real environment users reach |
| externally validated | someone outside this repo confirmed it |

Current ceilings: the capability compiler and spoken input are tested
with fixtures and synthetic input. No live microphone or third-party API
measurement exists. Do not write "works with any API" or
"hands-free control" in a doc.

## Layout

- `src/core/capabilities/` compilers, registry, execution, `DESIGN.md`
- `src/core/interaction/` command engine, speech grammar, push-to-talk
- `src/core/stores/` Zustand stores over the vault; `wireStore.ts` admits wires
- `src/core/services/` persona turns, wire context, LLM client; `server/` holds server-only code
- `src/core/gateway/` `ApiGateway` and normalizers for the built-in data sources
- `src/app/api/` server routes (LLM proxy, capability broker, inference runs)
- `e2e/` Playwright specs; `db/migrations/` ledger schema

## Cross-repo architecture

Architecture that spans repositories lives in `SyberLabs/MasterMind`. A change
here that alters a cross-repo contract is a proposal there first, not a decision
made in this repo.
