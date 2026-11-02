# OmniOS roadmap

Reviewed 2026-09-26. OmniOS is a local-first canvas for connecting data blocks.
Section 7 records what was cut on 2026-11-02; sections 3 and 6 are history and
name work that section removed.

## 1. Product core

- Shells save blocks, positions, and wires; built-in templates create working shells.
- Data blocks fetch and normalize public or configured provider data.
- Personas sit on the canvas and say AI answers are off in the public preview.
- IndexedDB stores local canvas state. Keyless public data goes through server
  routes; a key a person enters goes straight from the browser to that API.

## 2. Current boundaries

- **Wires are block-to-block, admitted by a two-layer check on the first ports
  only.** A wire stores source and target block IDs. `addWire` runs
  `admitConnection` (schema level, yields a projection) and then
  `evaluateWireAdmission` (the `dataType` check in
  `src/core/interaction/ports.ts`), and only the first input and first output
  port are checked. An untyped output acts as `any`: it feeds `any` inputs
  (personas) or string-sink schemas through a `text` projection, and typed
  text/json inputs without a string sink refuse it. Projections apply only in
  capability execution (`wireInputs.ts`).

## 3. Done (merged 2026-10-01)

1. **Block accessibility tree** (#75). dnd-kit's `attributes` and `listeners`
   are spread on the grip only (`src/components/blocks/BlockCard.tsx`), so a
   card is no longer a `role="button"` around its own controls. See
   `FINDINGS.md`.
2. **Recorded inference lineage** (#72). Removed in section 7.
3. **Persisted wires re-validated on load** (#74). Every load path runs the
   same `admitWire` as the live canvas: shell restore and templates through
   `replaceWiresForShell`, vault-hydrated wires through
   `revalidatePersistedWires` (`src/core/stores/wireStore.ts`). A refused wire
   is dropped with one `console.warn`. See `TYPED_PORT_SYSTEM.md`.

## 4. Cuts

- No public multi-user service, authentication system, plugin marketplace, or
  broad provider catalog without a demonstrated canvas need.
- No second product surface alongside the canvas.

## 5. Garden removal

The Garden and its life-system, stability, and equilibrium models were removed
on 2026-09-01. It was a separate product of roughly 15,000 lines whose central
value depended on longitudinal history that had not been built. Keeping it
alongside the canvas added a second architecture and unfinished surface without
delivering that value. The canvas is the product; Garden plans are retired.

## 6. Industrialization (planned 2026-10-12)

Goal: a new person gets a working answer from live data without hunting for
API keys. About two-thirds of the APIs Flyspace can use need a credential
(62 usable APIs in a 200-spec directory sample: 18 keyless, 4 partly keyless,
40 keyed), so the key is the main place people stop. The plan supplies data
and guidance, not shared credentials: no automated sign-ups and no pooled
free-tier keys (both break provider terms). One work package per item, in
this order:

1. **Line metrics.** A baseline before any change: catalog coverage (usable,
   keyless, keyed by kind, curated, verified) and time to a first answer from
   a fresh browser.
2. **Key concierge.** Each keyed API shows how to get its key: a direct link,
   honest time and requirements (email, phone, card), the free-tier limit, a
   format check on paste, and a live test call. Search can filter to APIs
   that need no key.
3. **Local key vault.** Opt-in, encrypted, browser-only storage so keys
   survive a reload. Never part of an account backup (#144) or a server.
4. **Quality line.** A nightly run calls every curated API and records when
   each was last verified; drift fails loudly instead of surfacing to a user.
5. **Kits.** Shells built only from verified parts that need no key, so a
   first run always works.
6. **Spec forge.** A developer tool that drafts a curated spec from provider
   docs, checks it against live calls, and leaves a person to approve it.
   Status: drafts with Claude, OpenAI or Gemini (`--provider`). Measured once
   on 2026-10-12 with Gemini 2.5 Pro: Open Library search docs, passed the
   checks in round 1, both operations answered live. Claude and OpenAI are
   tested with stubs only.
7. **Data plant.** Server-side house keys, used only where a provider's terms
   allow an application key, behind a shared cache with per-user quotas and
   provenance on every value. Lifts the "broad provider catalog" cut in
   section 4 for curated sources only; runs on local and private deployments
   first. Turning it on for the public preview is a separate owner decision
   under DEPLOYMENT.md (AGENTS.md stop condition 5).
   Status: implemented and tested with stubs. The owner opts APIs in by id
   (`OMNI_HOUSE_KEYS`); none is opted in, so nothing changed for anyone yet.
8. **Connect.** OAuth sign-in for providers that require it, Google first
   (504 directory APIs are blocked only by OAuth). Needs an OAuth client the
   owner registers.
   Status: implemented and tested with stubs, for Google, read operations
   with read-only scopes only. No live sign-in has been run (no client is
   registered). The API index still counts Google APIs as unusable until it
   is rebuilt (`npm run catalog:build`).

Items 1, 6, 7 and 8 were removed in section 7.

## 7. Reachability cut (2026-11-02)

Rule from the owner: a path is dead if no live deployed app can reach it. The one
live app is the Worker at omni.syberlabs.io, with demo mode on, no secret and no
database, so everything behind those facts went. Last present at `8a21350`:

- Model answers: the LLM client and route, persona prompts and engine, the Mind
  engine, kernel, crystallize, run lineage, the Think result modal, markdown
  rendering of answers. A turn now commits the preview's refusal.
- Postgres, migrations, the inference ledger, hosted OIDC auth.
- The capability broker's server side and data plant (house keys). A brokered
  block still runs and shows the broker's 503.
- OAuth sign-in. A Google block still says sign-in is not set up.
- Remote speech (OpenAI Realtime). The browser recognizer remains.
- Jev and Kev persona suggestions and meaning search. Keyword search remains.
- MCP and async transports, manifest provenance: no production caller bound one.
- Tooling only those paths used: `forge:spec`, `eval:registry-jev`,
  `metrics:line`, `db:migrate`, the speech field harness.

Kept because they build or guard the live artifact: `verify:curated` and the
nightly quality line (they write `public/curated-quality.json`, which search
shows), `catalog:build` (`public/api-index.json`), `scan:bundle`, the tests of
live code, and the 503 stubs the deploy gate checks.
