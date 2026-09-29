# Findings

Things noticed during the session that were not the item in hand.

## dnd-kit block cards are buttons that swallow inner button names
Where: `src/components/blocks/BlockCard.tsx` (the `motion.div` is a dnd-kit draggable, which sets `role="button"`). Inner controls like World Bank's `Apply` then collide in the accessibility tree — Playwright saw two "Apply" buttons, one of them the entire card (`World Bank World Bank` plus the inner label).
Why it matters: keyboard and AT users get a giant button wrapping other buttons. The persistence e2e had to use `{ name: 'Apply', exact: true }` to escape it.
What I would do: stop promoting the card itself to `role="button"` (dnd-kit `role` option / drag handle only), so inner controls keep unique names.

## Empty OmniItem arrays are cited as grounding — fixed 2026-09-29
Where: `src/core/services/wire.service.ts`. `extractBlockData` returned the string `'(No data)'` for an empty `items` array (and `'(No entries)'` for an empty Memory pool), and `aggregateWireContext` treats any returned string as a contributing source.
Why it mattered: the invariant is that a source which carried no data is not grounding and must not be cited. A connected-but-empty block still got a provenance chip.
What was done: `extractBlockData` now returns `null` when the extracted text is empty (empty `items`, empty Memory pool, empty `markets`/`articles` including after a time-window filter, an empty direct array, blank text), matching the persona-error path. The wire's stale/empty status is unchanged; it is status, not provenance. An old test that asserted an empty Memory block "IS cited" enshrined the bug and was reversed.
Not covered: a block whose data is an empty object `{}` still goes through the generic JSON fallback and is cited as `{}`.

## Mind panel Think still snapshots the whole shell — fixed 2026-09-29
Where: `src/core/services/mind.engine.ts` `think()` / `thinkStream()` via `captureShellSnapshot()`.
Why it mattered: persona turns are wire-only. Think fed the LLM a snapshot of every stored block in every shell, wired or not, plus `useMindShellSync`'s awareness aggregates (all blocks of a type, any shell) through the observations pool.
What was done: `captureShellSnapshot` keeps only blocks of the active shell with an active wire in or out (both ends on that shell) or pinned; pins outside that scope and awareness entries are dropped; the prompt heading and instructions say "wired or pinned in this shell". `think()` and `thinkStream()` both refuse with a clear message when nothing is in scope. Think was kept, not retired, because the existing pin feature is a coherent explicit way in.
Still true: earlier Think answers stay in the observations pool and come back as recent observations; those written before this change were made under the old scope. The Mind panel still displays the global awareness entries (display only, no longer in Think's prompt), and `useMindShellSync` itself still aggregates across shells.

## Unused ApiConfig on the block schema
Where: `src/core/schemas/block.schema.ts` ~190. A separate `ApiConfig` with an `apiKey` field. Nothing imports it.
Why it matters: a second type named ApiConfig next to `api.schema.ts`'s is how a key field reappears by accident.
What I would do: delete the unused interface.

## Unused store lookups
Where: `PersonaBlock.tsx` ~48 `getBlock`, `WireHandle.tsx` ~61 `getBlock`, `MindPanel.tsx` ~9 `useBlockStore`.
Why it matters: lint warnings only, but they are leftovers from earlier edits.
What I would do: drop the unused bindings.

## FRED / Alpha Vantage must put the key in the upstream query string
Where: `src/core/services/server/data.providers.ts` FRED and Alpha Vantage `buildRequest`. Those APIs have no header auth.
Why it matters: the key is in a URL we send to the provider (allowed) and could appear in an undici error message (now stripped from the 502 body). Access logs on their side are theirs.
What I would do: nothing further unless a provider adds header auth.

## Turbopack compile cache can hold inlined env values
Where: `.next/cache/turbopack/**/*.sst` after `next build`. Not the client bundle (`.next/static` was clean).
Why it matters: a machine-local cache is inside the security boundary, but copying `.next` off the machine would copy it.
What I would do: keep `.next` gitignored (it is). Do not treat cache hits as a client leak.


