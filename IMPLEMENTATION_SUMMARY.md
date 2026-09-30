# Implementation summary

Reviewed 2026-09-26. OmniOS is a canvas of data blocks, personas, and saved
shells. The current roadmap is in [`APEX_PLAN.md`](APEX_PLAN.md).

## Current behavior

- `wireStore` stores canvas edges by source and target block ID, plus the first
  declared port of each end and a `projection`. Every wire creation path (canvas
  drag, spoken command, crystallized memory) goes through `addWire`, which
  refuses self-wires, cross-shell wires, and typed mismatches. Shell restore and
  templates re-run the schema-level check. Blocks without declared ports stay
  untyped and still connect. See [`TYPED_PORT_SYSTEM.md`](TYPED_PORT_SYSTEM.md).
- Persona turns assemble context from active inbound wires and keep provenance
  for sources that contributed data.
- Mind-panel Think captures all blocks and wires currently in the stores. Mind
  sync also reads every stored block into shared Mind pools; neither path filters
  by shell.
- Core canvas state is persisted locally through OmniVault. When configured,
  Postgres records inference runs and source lineage; it does not own canvas
  state. See [`INFERENCE_LEDGER.md`](INFERENCE_LEDGER.md).

## Scope

The canvas and its human-visible source path are the product core. Garden plans,
plugins, and public multi-user hosting are not current product capabilities.
