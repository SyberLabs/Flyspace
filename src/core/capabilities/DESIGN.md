# Capability compiler

OMNI learns a previously unknown API by compiling it into a
`CapabilityManifest`, then registering that manifest as a block type in the
block registry that already exists. No new block file is required.

## What stays the same

`API_CATALOG` and its normalizers are untouched. Wires between blocks that do
not declare a `ValueType` are still accepted. Ports without a schema remain
visual hints.

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

## Providers and admission

A `CapabilityProvider` (`provider.ts`) discovers candidates in one external
ecosystem and materializes a `CapabilityProposalV1`. `providers/openapiProvider.ts`,
`providers/mcpProvider.ts`, and `providers/bringProvider.ts` wrap the three
compilers above; they do not parse a second way. A proposal carries an effect
*hint*, an auth *placement*, a transport, schemas, and provenance. It has no
id, approval, digest, credential slot, or trust flag, and `admission.ts`
refuses a proposal that includes one.

`admitProposal` derives what a provider may not claim: the id from the
transport, the effect from the method floor (an MCP read hint counts only for
a server on the host's `trustedEffectHints` list, and the same holds for an
async runtime), the approval from the
effect, and the credential slot from the destination. It seals provenance
(provider, external id, source locator and revision, discovery and admission
time, schema digest) into the digest, then calls `installProposal`.
`providers/maxunProvider.ts` is a `web_data` provider: a scrape robot becomes
`{ markdown: string }`, an extract robot becomes an object of its declared
text fields, and a robot with no declared fields is reported, not admitted as
`any`. Its proposals use the async `maxun` runtime (`providers/maxunRuntime.ts`)
with the API key in the `x-api-key` slot. That runtime's start is fenced: Maxun's
open-source server answers `POST /api/robots/:id/runs` only after the run
finishes, so no run id could be recorded for a run longer than one request.
Until an early-acknowledgement start is verified, start sends nothing and
execution fails `ASYNC_START_REJECTED`. Only the run lookup by id is implemented.
`providers/maxun.evaluation.ts` records that no live Maxun run was performed.
`providers/managedProvider.ts` is a `managed_integration` provider: a
Pipedream- or Composio-style catalog entry becomes an http proposal against the
SaaS API itself, with `oauth` auth. An `oauth` binding carries scopes and a
slot (one slot per origin and scope set); the token enters the slot through a
host connect flow that does not exist yet, so until then execution is
`AUTH_UNBOUND`. `oauth` is http-only and never rides `server_broker`.
`providers/managed.decision.ts` rejects both vendors as dependencies.
Admission
does not place blocks or wires. The OpenAPI install panel still calls
`compileOpenApi` directly.

`validateManifest` rebuilds the canonical object and checks the digest.
`installProposal` is the gate that registers anything. A write or destructive
proposal is stored as `pending` even if it arrived marked `approved`.
`approveCapability` is the only way into `approved`. `restoreSnapshot` may
keep an approval the user already granted, because that blob came from this
store, and it is revalidated first.

## Production boundaries

A manifest describes a capability. It does not grant itself authority.

- Credential slots are `origin + scheme + placement`. Two APIs that both name a scheme `ApiKey` do not share a secret, and a proposal cannot point its `secretRef` at another origin's slot. A run cannot supply a header input in the header the credential travels in (`Authorization`, or the apiKey header name, in any case); that is `INPUT_INVALID`.
- HTTP method is an effect floor. `x-omni-effect` and MCP annotations may raise that floor. They cannot turn POST into auto-running compute. Untrusted MCP `readOnlyHint` is not approval.
- Capability ids are a hash of canonical origin and operation. Speech handlers keep pinned ids. A different origin cannot reuse an existing id.
- Wires enter through `admitConnection`. Typed mismatches are refused. A string sink may record `text` or `join_titles` instead of pretending the source was already that string.
- Execution is one runtime: `executeCapability`. Each run is a vault record with an idempotency key. The same key and the same request replays; a different request under that key conflicts. The request is compared by its digest (the one a write confirms), and the broker's server ledger compares the method and URL it sends, taken before the credential is added. A write that leaves the process and then throws, or is still `running` after its deadline, is `EFFECT_UNCERTAIN` and is not retryable. Inference runs use the same words in Postgres, including `uncertain` after a stream breaks.
- Triggers are `manual`, `on_create` (once per block), `on_input_change`, and `interval`. Write and destructive stay manual. Mounting a view is not a trigger.
- HTTP capabilities are `browser_direct` or `server_broker`. A provider cannot choose: admission sets `browser_direct` unless the host's `AdmissionPolicy.brokerOrigins` names the origin, and then only for read and compute. The broker rebuilds the URL from the manifest, refuses private and metadata addresses, and refuses write and destructive effects.
- A base URL is https, carries no query or fragment, and an IP literal in it must be public. Loopback (http or https) is allowed only when the host itself built the manifest (`validateManifest(..., { hostCreated: true })`). Unsupported OpenAPI constructs fail compilation instead of becoming `any`.
- MCP tools compile from schemas and run through `mcpClient.ts`, a thin adapter over the official TypeScript SDK v2 (`@modelcontextprotocol/client`). The SDK negotiates the protocol era (`auto`: probe 2026-07-28, fall back to the 2025 handshake) and forwards cancellation. An MCP credential slot is keyed by server id; execution resolves it and passes it as per-call headers, so revoking the slot stops the next call. A sync MCP call is bounded by the same 15 s request timeout as HTTP.
- Long work uses the `async_poll` profile, never a longer request timeout. The transport is `{ kind: 'async', runtimeId, operation }`: the host binds the runtime (`asyncRuntime.ts`) and its endpoint, and a proposal cannot name one. `start` returns an external run id, which the vault ledger records before polling. Each start and each poll is still one request of at most 15 s, and the whole run is bounded by the profile's `maxDurationMs` (at most one hour): no sleep or poll request extends past that deadline, except the single observation recovery makes of a run that already outlived it. A run this session is still polling is not expired underneath it by another admission; it settles its own row. Omni never repeats a start. A write that was started and not observed to finish (deadline, repeated poll failures, or cancel) is `uncertain`. `reconcileAsyncExecution` and `recoverAsyncExecutions` read the ledger after a reload and poll the external run id; an uncertain run closes only when the destination reports a terminal status. Async capabilities run manually only. An untrusted async runtime lands at `write`, like an untrusted MCP server. The server ledger carries the same fields (`db/migrations/005_capability_async.sql`).
- Speech has a session id, a source (`unknown` until a local adapter proves otherwise), and cancel. A denied microphone is `Permission denied`, not the browser error code.

## Effects

| Effect | Default methods | Runs when |
| --- | --- | --- |
| read | GET, HEAD | the user runs it |
| compute | `x-omni-effect: compute` on a safe method, or an explicit bring/MCP declaration | the user runs it |
| write | POST, PUT, PATCH | approval is `approved`, and the user confirms the shown request for this run |
| destructive | DELETE, or `destructiveHint`, or a tightened GET/HEAD | approval is `approved`, and the user confirms the shown request for this run |

Approval admits a capability; it does not admit its arguments. Before each
write or destructive run, `previewCapabilityRun` resolves the method, the URL
(without the credential) and the arguments, and the block shows them.
`executeCapability` dispatches the run only with the digest of that exact
preview (`confirmedRun`); different arguments, including a wire that changed
after the preview, are refused as `CONFIRMATION_REQUIRED`. A run is prepared
once: its arguments (every declared input supplied, in an object with no
prototype) and, for http, the exact URL, header values and body text. The
digest is computed from that prepared run, and dispatch sends the same
objects. Each argument is copied once into the JSON domain and frozen:
strings, finite numbers, booleans, null, dense arrays and plain objects, with
-0 written as 0. Inside a value, `undefined`, `NaN`, `±Infinity`, a BigInt, a
function, a symbol (as a value or a key), a non-plain object (a `Date`, `Map`,
`Set`, class instance, or anything with `toJSON`), a sparse array, an accessor
and a `__proto__` key are `INPUT_INVALID` before any preview exists. The
digest hashes the exact JSON text of that copy, and the MCP tool, the async
runtime and the local handler each receive that same object. An input
left `undefined` at the top level is not supplied. An input or apiKey name may not be `__proto__`, `prototype`, or a
name `Object.prototype` defines. A path argument
fills one path segment: `.` and `..` are refused, and the resolved pathname
must equal the expanded template.

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

1. registers an `OmniBlockSchema` whose ports carry the real schemas
2. mirrors the manifest into the vault-backed capability store

Removing a capability drops its block type and its canvas instances.

Canvas views resolve unknown `cap_*` ids through `getBlockView` to one shared
`CapabilityBlockView`. A block runs through `runInstalledCapability`, not the
API gateway. `invocation: auto` (an `on_create` trigger) runs once when the
block is created. `invocation: manual`, and every write or destructive effect,
wait for an explicit control. Invocation is part of the digest because it
changes when the capability runs. Approval stays outside the digest.

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
