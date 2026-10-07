# Ports and wire admission

Declared ports are enforced when a wire is created. A wire is an admitted edge,
not a line the canvas draws first. Blocks that declare no ports are untyped and
still connect (see below).

## What a port is

A block schema may declare ports (`PortSchema` in
`src/core/schemas/block.schema.ts`): an ID, a direction, a `dataType`
(`json`, `text`, `media`, `any`), and optionally a native `schema` (a
`ValueType` from `src/core/capabilities/valueType.ts`, present on capability
ports). Only the **first** declared output port of the source and the **first**
declared input port of the target take part in admission. `BlockCard` and
`WireHandle` render the same first port as the visible handle.

## What is checked

`wireStore.addWire` runs `admitWire` (`src/core/stores/wireStore.ts`), which
applies two checks in order. Any refusal returns `''` and leaves the graph
unchanged.

1. **`admitConnection`** (`src/core/capabilities/compatibility.ts`):
   - refuses a self-wire, a missing block, and a wire between two shells;
   - when both ports carry a `schema` and the target is not `any`, the source
     must be assignable to the target (`isAssignable`), otherwise the wire is
     refused with a sentence naming both ports and kinds;
   - returns the projection to record on the wire (below).
2. **`evaluateWireAdmission`** (`src/core/interaction/ports.ts`), on
   `dataType`: an `any` input accepts every output, an `any` output feeds only an
   `any` input, otherwise the types must be equal. A mismatch is refused unless
   check 1 already chose a `text` or `join_titles` projection.

## Untyped blocks

A block with no declared ports is treated as an `any` output and an `any`
input. As a target it accepts anything. As a source it feeds `any` inputs
(persona blocks declare `any` inputs, so data-to-persona wires need no
conversion). It is refused by a target that declares a typed `text`, `json`, or
`media` input with no string-sink schema.

## String sinks and projections

A target is a string sink if its input schema is a `string`, or an object with
exactly one required property that is a `string`. Each admitted wire records a
`projection` (`DataWire.projection`):

| Projection | When |
| --- | --- |
| `identity` | source is assignable to target, or nothing is declared |
| `text` | string-sink target, and the source declares no `schema` |
| `join_titles` | string-sink target, and the source is an array |

If both ends declare a `schema` and they are not assignable, the wire is refused
even for a string sink, unless the source is an array (`join_titles`). `text` and
`join_titles` are explicit conversions, not type equality. They are applied only
by capability execution (`resolveWiredInputs` in
`src/core/capabilities/wireInputs.ts`). Persona context
(`aggregateWireContext`) formats each source block's data as text and does not
read ports or projections.

## What a refusal looks like

`addWire` sets `useWireStore.getState().lastAdmissionRefusal`. It is a sentence
from `admitConnection` (for example `wires stay inside one shell`), a code from
`evaluateWireAdmission` (`incompatible-type`, `no-output`, `no-input`). Spoken and pointer input read it and answer "I can't wire
those." `wireService.createWire` returns `''` on a refusal; `addWire`, which it
calls, has already set it.

## Restore and templates

Every load path runs the same `admitWire` as `addWire`:

- shell restore and template instantiation write wires through
  `replaceWiresForShell`;
- undoing a delete (`src/core/interaction/session.ts`) hands the block's wires
  back through `replaceWiresForShell`;
- wires hydrated from the vault are re-admitted by `revalidatePersistedWires`
  once both the block store and the wire store have hydrated.

A refused wire is dropped from the active canvas and logged with one
`console.warn` naming the wire and the reason. The saved shell record in
`shellStore` is not rewritten. The wire store's own vault entry mirrors the
canvas, so the persist write that follows re-admission removes the refused wire
there too; the warning is the record of it.

## Tests

`src/core/interaction/interaction.test.ts` (typed wire admission, refusal in the
store), `src/core/interaction/session.test.ts` (undo of a delete restores the
wires once, by id, and drops one the canvas now refuses), `src/core/capabilities/boundary.test.ts` (`join_titles` projection,
typed mismatch refused), and `src/core/stores/wireAdmission.test.ts` (hydrate
and shell restore drop an incompatible wire; every built-in template's wires
pass `admitWire`).
