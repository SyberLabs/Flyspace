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
