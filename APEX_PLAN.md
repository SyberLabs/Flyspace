# OmniOS roadmap

Reviewed 2026-09-26. OmniOS is a local-first canvas for connecting data blocks to
AI personas and seeing which sources informed each response.

## 1. Product core

- Shells save blocks, positions, and wires; built-in templates create working shells.
- Data blocks fetch and normalize public or configured provider data.
- Persona turns use active inbound wires, stream a response, and retain source
  provenance. Optional Postgres records inference runs and their lineage.
- IndexedDB stores local canvas state. Provider calls that use credentials pass
  through server routes.

## 2. Current boundaries

- **Wires are block-to-block, admitted by a two-layer check on the first ports
  only.** A wire stores source and target block IDs. `addWire` runs
  `admitConnection` (schema level, yields a projection) and then
  `evaluateWireAdmission` (the `dataType` check in
  `src/core/interaction/ports.ts`), and only the first input and first output
  port are checked. An untyped output acts as `any`: it feeds `any` inputs
  (personas) or string-sink schemas through a `text` projection, and typed
  text/json inputs without a string sink refuse it. Persona context
  (`aggregateWireContext`) ignores ports and projections; projections apply
  only in capability execution (`wireInputs.ts`).
- **Mind-panel Think sees what the canvas shows.** `captureShellSnapshot`
  (used by `think()`) keeps only blocks of the active shell that have a wire in
  or out, or are pinned, plus only the wires between them and the pins on them.
  It does not read the observations pool, so earlier answers do not reach the
  prompt. With
  nothing in scope, Think is refused unless the caller passes a question
  (Quick Ask).

## 3. Done (merged 2026-10-01)

1. **Block accessibility tree** (#75). dnd-kit's `attributes` and `listeners`
   are spread on the grip only (`src/components/blocks/BlockCard.tsx`), so a
   card is no longer a `role="button"` around its own controls. See
   `FINDINGS.md`.
2. **Recorded inference lineage** (#72). `src/blocks/persona/RunLineage.tsx`
   reads the runs behind a persona answer through
   `GET /api/inference-runs/:id/lineage` and draws the tree from a toggle
   under the answer.
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
