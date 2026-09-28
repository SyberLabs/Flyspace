# Capability compiler

OMNI learns a previously unknown API by compiling it into a
`CapabilityManifest`, then registering that manifest through the gateway and
block registry that already exist. No new block file is required.

## What stays the same

`API_CATALOG` and its normalizers are untouched. `ApiGateway.fetch` still
returns `OmniData`. Wires between blocks that do not declare a `ValueType`
are still accepted. Ports without a schema remain visual hints.

## What a manifest is

A manifest is one callable: identity, effect, approval, an auth *slot* (never
a secret), a transport, input schemas, and an output schema. The digest is
SHA-256 over the canonical body. Approval is not part of the digest, so
granting approval does not create a new capability.

Three compilers propose manifests:

- `compileOpenApi` reads an OpenAPI 3.x document.
- `compileMcpTools` reads MCP tool schemas. Calling them requires a bound
  `McpTransport`; the compiler itself does not open a connection.
- `compileBring` reads a structured description. Free text is not a proposal.

`validateManifest` rebuilds the canonical object and checks the digest.
`installProposal` is the gate that registers anything. A write or destructive
proposal is stored as `pending` even if it arrived marked `approved`.
`approveCapability` is the only way into `approved`. `restoreSnapshot` may
keep an approval the user already granted, because that blob came from this
store, and it is revalidated first.

## Effects

| Effect | Default methods | Runs when |
| --- | --- | --- |
| read | GET, HEAD | installed |
| compute | `x-omni-effect: compute` on a safe method, or an explicit bring/MCP declaration | installed |
| write | POST, PUT, PATCH | approval is `approved` |
| destructive | DELETE, or `destructiveHint` | approval is `approved` |

A method cannot be relabeled into a weaker class. DELETE stays destructive.
GET cannot be write or destructive.

## Two values, one call

`executeCapability` checks approval, validates inputs, resolves the secret
slot, performs the call, and validates the response against the output
schema. The result has:

- `typed` — the native value and its `ValueType`
- `presentation` — an `OmniData` projection for the gateway, feed view, and
  wire extractor

The typed value is not written onto `OmniData`. Block data keeps them as
siblings (`typed` and `items`). Wires keep reading `items`.

## Runtime registration

Installing a manifest:

1. registers an `ApiTypeDefinition` on `apiGateway` under the capability id
2. registers an `OmniBlockSchema` whose ports carry the real schemas
3. mirrors the manifest into the vault-backed capability store

`cap_` ids are the only ones `unregisterType` will remove, so a capability
cannot uninstall Polymarket. Removing a capability drops its gateway entry,
its block type, and its canvas instances.

Canvas views resolve `cap_*` through `getBlockView` to one shared
`CapabilityBlockView`. Read and compute run on open. Write and destructive
wait for an explicit Run after approval.

## Wire check

`createWire` refuses the connection only when both ends declare a schema and
the output is not assignable to the input. `any`, and every current catalog
port (no schema), still connect.
