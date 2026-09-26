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

- **Wires connect blocks, not typed ports.** A wire stores source and target
  block IDs. `PortSchema` types are visual hints shown on the first handle for
  each side; the canvas does not validate compatibility or convert wire data.
- **Mind context is global across the blocks currently in the stores.**
  `useMindShellSync` reads every stored block into shared Mind pools, without
  filtering by shell. `captureShellSnapshot` includes every stored block and
  wire. Mind-panel Think therefore has broader context than persona turns,
  which use only their active inbound wires. Per-shell Mind isolation is not
  implemented.

## 3. Remaining work

1. **Keep provenance honest.** Empty data arrays and empty Memory pools currently
   produce placeholder text that can still be cited as a source. Return no source
   for empty content. See `FINDINGS.md`.
2. **Resolve Mind-panel scope.** Decide whether Mind-panel Think should be retired
   or limited to explicitly selected sources; do not describe its current
   whole-store snapshot as per-shell context.
3. **Fix the block accessibility tree.** A draggable BlockCard can be exposed as
   a button around its own controls. Keep drag semantics on the handle and give
   nested controls independent names. See `FINDINGS.md`.
4. **Expose recorded inference lineage.** The server can return the runs behind a
   persona answer; the canvas does not yet show that tree from a source chip.

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
