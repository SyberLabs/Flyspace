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

## Production boundaries

A manifest describes a capability. It does not grant itself authority.

- Credential slots are `origin + scheme + placement`. Two APIs that both name a scheme `ApiKey` do not share a secret, and a proposal cannot point its `secretRef` at another origin's slot.
- HTTP method is an effect floor. `x-omni-effect` and MCP annotations may raise that floor. They cannot turn POST into auto-running compute. Untrusted MCP `readOnlyHint` is not approval.
- Capability ids are a hash of canonical origin and operation. Speech handlers keep pinned ids. A different origin cannot reuse an existing id.
- Wires enter through `admitConnection`. Typed mismatches are refused. A string sink may record `text` or `join_titles` instead of pretending the source was already that string.
- Execution is one runtime: `executeCapability`. Each run is a vault record with an idempotency key. The same key and input replays. A write that leaves the process and then throws, or is still `running` after its deadline, is `EFFECT_UNCERTAIN` and is not retryable. Inference runs use the same words in Postgres, including `uncertain` after a stream breaks.
- Triggers are `manual`, `on_create` (once per block), `on_input_change`, `interval`, and `event`. Write and destructive stay manual. Mounting a view is not a trigger.
- HTTP capabilities are `browser_direct` or `server_broker`. The broker rebuilds the URL from the manifest, refuses private and metadata addresses, and refuses write and destructive effects. Unsupported OpenAPI constructs fail compilation instead of becoming `any`.
- MCP tools compile from schemas and run through a Streamable HTTP client once a server URL is bound.
- Speech is an observation with a session id, a source (`unknown` until a local adapter proves otherwise), and cancel. Interim results stay on the session until a final transcript. A denied microphone is `Permission denied`, not the browser error code. `Promise<string>` is only the final transcript the block stores.

## Effects

| Effect | Default methods | Runs when |
| --- | --- | --- |
| read | GET, HEAD | the user runs it |
| compute | `x-omni-effect: compute` on a safe method, or an explicit bring/MCP declaration | the user runs it |
| write | POST, PUT, PATCH | approval is `approved` and the user runs it |
| destructive | DELETE, or `destructiveHint`, or a tightened GET/HEAD | approval is `approved` and the user runs it |

A method cannot be relabeled into a weaker class. GET and HEAD may be tightened to write or destructive. POST, PUT, and PATCH are at least write. DELETE stays destructive. An observed HTTP error on a write or destructive call is not marked retryable.

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

Canvas views resolve unknown `cap_*` ids through `getBlockView` to one shared
`CapabilityBlockView`. Read and compute with `invocation: auto` run on open.
`invocation: manual`, and every write or destructive effect, wait for an
explicit control. Invocation is part of the digest because it changes when
the capability runs. Approval stays outside the digest.

## Install session

The Armory hosts the only product door into `installProposal`: paste an
OpenAPI document, compile it, review effect and auth slots, and install the
checked operations. Secret values are written only to the in-memory session
slot and cleared from the form. The panel never calls `restoreSnapshot` and
never marks a proposal approved. Approve and Deny are separate controls on
installed write and destructive capabilities.

## Typed wires at execution

`createWire` refuses the connection only when both ends declare a schema and
the output is not assignable to the input. `any`, and every current catalog
port (no schema), still connect.

A capability with a single required string input exposes that input port as
`any`, so a feed, a text block, or a persona can connect. At execution,
`resolveWiredInputs` projects the upstream value into named arguments:

1. typed object fields that match input names and schemas
2. a single typed value that matches the only input
3. the latest assistant message that is not a warning
4. text-block `content`
5. joined item titles, when the only required input is a string

`runInstalledCapability` merges wired values, then block params, then the
explicit `run()` input. A wire that matches nothing is ignored.

## Local transport and speech

`transport.kind: local` names a handler (`speech.speak`, `speech.listen`).
Handlers are bound in process. There is no network call and no secret.

Speak and Listen ship as built-in manifests (`cap_speech_speak`,
`cap_speech_listen`). Both are manual. Speak is compute. Listen is read.
The browser engine uses `speechSynthesis` and `SpeechRecognition` when they
exist. Speak stays unavailable until the browser reports at least one voice.
Speak gives up after 60 seconds.
Listen gives up after 15 seconds and stops the recognition session. Tests
replace the engine with `setSpeechEngine`. Utterances are capped at 5000
characters. The install session refuses to install a selected operation
while its secret slot is empty.

`ensureSpeechCapabilities` binds the handlers and installs the manifests when
their digest is missing. It runs at startup and after `restoreSnapshot`, so
a snapshot that omits speech does not drop the builtins. A user removal
lasts until the next ensure. The install list hides the `speech` locator so
builtins are not reviewed as pasted APIs. Their canvas views are
`SpeechBlockView`, registered ahead of the generic `cap_` fallback.
