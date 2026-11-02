# Capability compiler

OMNI learns a previously unknown API by compiling it into a
`CapabilityManifest`, then registering that manifest as a block type in the
block registry that already exists. No new block file is required.

## What stays the same

`API_CATALOG` and its normalizers are untouched. Wires between blocks that
declare no ports are still accepted: both sides default to `any`. A declared
port is a runtime contract, not a visual hint. Its `dataType` is enforced by
`evaluateWireAdmission` (`src/core/interaction/ports.ts`) whether or not the
port carries a `schema`; only the `ValueType` projection check in
`src/core/capabilities/compatibility.ts` needs a schema on both ports. See
`TYPED_PORT_SYSTEM.md`.

## What a manifest is

A manifest is one callable: identity, effect, approval, an auth *slot* (never
a secret), a transport, input schemas, and an output schema. The digest is
SHA-256 over the canonical body. Approval is not part of the digest, so
granting approval does not create a new capability.

`compileOpenApi` reads an OpenAPI 3.x document and proposes manifests. The only
other transport is `local`, for the built-in speech handlers.

## OAuth

An `oauth` binding carries scopes and a slot (one slot per origin and scope
set). The public preview has no sign-in, so nothing fills that slot: the block
says sign-in is not set up (`connect.ts`) and execution is `AUTH_UNBOUND`.
`oauth` is http-only and never rides `server_broker`. `compileOpenApi` binds
an OpenAPI oauth2 scheme only for a provider in `connectProviders.ts`
(Google), only when the API is on that provider's own hosts, and only for a
read operation with a read-only scope; a write that needs a sign-in is
refused.

## Installing

`validateManifest` rebuilds the canonical object and checks the digest.
`installProposal` is the gate that registers anything. A write or destructive
proposal is stored as `pending` even if it arrived marked `approved`.
`approveCapability` is the only way into `approved`. `restoreSnapshot` may
keep an approval the user already granted, because that blob came from this
store, and it is revalidated first. A vault import is not that blob: a file
can have come from anywhere, so `prepareVaultImport` (`importAdmission.ts`)
runs every write and destructive entry of the imported `omni-capabilities`
blob through the same `sideEffectPending` rule as `installProposal` before
it is written, the import reports which capabilities need approval again,
and read and compute entries pass unchanged.

## Production boundaries

A manifest describes a capability. It does not grant itself authority.

- Credential slots are `origin + scheme + placement`. Two APIs that both name a scheme `ApiKey` do not share a secret, and a proposal cannot point its `secretRef` at another origin's slot. A run cannot supply a header input in the header the credential travels in (`Authorization`, or the apiKey header name, in any case); that is `INPUT_INVALID`. Neither the credential nor a header input may be placed in a hop-by-hop, framing or transport header (`Connection`, `Content-Length`, `Host`, `Transfer-Encoding`, `Cookie`, ...: `DENIED_HEADER_NAMES` in `manifest.ts`, matched in any case); that fails validation at compile and install, not at execute. A secret value is at most 4096 bytes (`MAX_SECRET_BYTES`) where it enters the session slot.
- HTTP method is an effect floor. `x-omni-effect` may raise that floor. It cannot turn POST into auto-running compute.
- Capability ids are a hash of canonical origin and operation. Speech handlers keep pinned ids. A different origin cannot reuse an existing id.
- Wires enter through `admitConnection`. Typed mismatches are refused. A string sink may record `text` or `join_titles` instead of pretending the source was already that string.
- Execution is one runtime: `executeCapability`. Each run is a vault record with an idempotency key. The same key and the same request replays; a different request under that key conflicts. The request is compared by its digest (the one a write confirms). A write that leaves the process and then throws, or is still `running` after its deadline, is `EFFECT_UNCERTAIN` and is not retryable.
- Triggers are `manual`, `on_create` (once per block), `on_input_change`, and `interval`. Write and destructive stay manual. Mounting a view is not a trigger.
- HTTP capabilities are `browser_direct` or `server_broker`. `compileOpenApi` sets `server_broker` only when the host asks for it, and then only for read and compute; `validateManifest` refuses a brokered write, destructive or oauth manifest. The public preview has no broker: `/api/capability-broker` answers 503, and a brokered block shows that error.
- A base URL is https, carries no query or fragment, and an IP literal in it must be public. Loopback (http or https) is allowed only when the host itself built the manifest (`validateManifest(..., { hostCreated: true })`). Unsupported OpenAPI constructs fail compilation instead of becoming `any`, with one exception: a response field below the top level that declares no type is typed `any` (`ConvertOptions` in `jsonSchema.ts`), because the API does return it and an `any` source is never assignable to a typed input. A response that is untyped as a whole, or a result list of untyped items, still fails, and so does an untyped input.
- Speech has a session id, a source (`unknown` until a local adapter proves otherwise), and cancel. A denied microphone is `Permission denied`, not the browser error code.

## Effects

| Effect | Default methods | Runs when |
| --- | --- | --- |
| read | GET, HEAD | the user runs it |
| compute | `x-omni-effect: compute` on a safe method, or an explicit declaration on a host-built manifest | the user runs it |
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
digest hashes the exact JSON text of that copy, and the local handler
receives that same object. An input
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
checked operations. Beside every proposal row and every secret field the panel
shows the origin of `transport.baseUrl` and the auth kind and placement
(`auth.kind`, `auth.in`, `auth.name`), and warns when a key is placed in the
query string, because a pasted document chooses the title and the destination
and the title alone must not stand for where a credential goes. Secret values
are written only to the in-memory session slot and cleared from the form. The panel never calls `restoreSnapshot` and
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
