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
  It does not read the observations pool, so neither earlier answers nor
  `useMindShellSync`'s all-shell awareness entries reach the prompt. With
  nothing in scope, Think is refused unless the caller passes a question
  (Quick Ask).

## 3. Remaining work

1. **Fix the block accessibility tree.** A draggable BlockCard can be exposed as
   a button around its own controls. Keep drag semantics on the handle and give
   nested controls independent names. See `FINDINGS.md`.
2. **Expose recorded inference lineage.** The server can return the runs behind a
   persona answer; the canvas does not yet show that tree from a source chip.
3. **Re-validate persisted wires on load.** Shell restore and templates
   re-run only `admitConnection`, via `replaceWiresForShell`; they skip the
   `dataType` check in `evaluateWireAdmission`, and wires loaded from storage
   are not re-validated at all. A wire the live canvas would refuse can
   therefore reappear after a reload. Separate work package; not fixed here.

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
