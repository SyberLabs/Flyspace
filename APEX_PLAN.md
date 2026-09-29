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
  (used by `think()` and `thinkStream()`) keeps only blocks of the active shell
  that have an active wire in or out, or are pinned, plus only the wires between
  them and the pins on them. It leaves out `useMindShellSync`'s awareness
  entries, which aggregate every block of a type across all shells and are still
  written to the shared observations pool and shown in the Mind panel. Earlier
  Think answers stay in the observations pool and are fed back as recent
  observations; they were produced under the old, wider scope until they age out
  of the last-20 window.

## 3. Remaining work

1. ~~**Keep provenance honest.**~~ Done 2026-09-29. `extractBlockData` returns
   `null` for empty items, empty Memory pools, empty markets/articles (including
   after a time-window filter) and blank text, so `aggregateWireContext` no
   longer cites a source that carried nothing. The wire's stale/empty status is
   still shown as status. See `FINDINGS.md`.
2. ~~**Resolve Mind-panel scope.**~~ Done 2026-09-29. Think is kept and limited
   to the active shell's wired or pinned blocks (see section 2). It is not
   retired: pinning already exists as an explicit way to put a block in scope.
   Not measured with users.
3. **Fix the block accessibility tree.** A draggable BlockCard can be exposed as
   a button around its own controls. Keep drag semantics on the handle and give
   nested controls independent names. See `FINDINGS.md`.
4. **Expose recorded inference lineage.** The server can return the runs behind a
   persona answer; the canvas does not yet show that tree from a source chip.
5. **Re-validate persisted wires on load.** Shell restore and templates
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
