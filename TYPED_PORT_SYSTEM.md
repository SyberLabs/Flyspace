# Port metadata and wire behavior

## What ports do

Block schemas can declare a port ID, direction, data type, label, and description.
`BlockCard` uses the input/output declarations to render the left and right wire
handles. `WireHandle` displays the first port's type and label as a visual hint.

These fields do not currently enforce a data contract. The canvas resolves a
drop to a target **block ID** and creates a wire between block IDs. Template
connections and crystallized-memory wires also create block-to-block edges.
Restored shells load their saved block-to-block wires. None of these paths runs
port compatibility validation.

## Data flow

`aggregateWireContext` reads active inbound wires for a persona, extracts each
source block's data, and formats it as text for the persona prompt. It does not
look up port IDs or convert data according to a port type. The old standalone
compatibility and conversion helpers had no production callers and have been
removed.

## Current limitation

Any block card can be a wire target, and the canvas accepts the connection
without checking whether that target consumes the data. Current persona inputs
are declared `any`, so the shipped data-to-persona path does not need type
conversion. Strict type validation would require a real port-level contract and
enforcement on every wire creation and restore path; the current code does not
provide that contract.
