# Findings

Things noticed during the session that were not the item in hand.

## dnd-kit block cards are buttons that swallow inner button names
Where: `src/components/blocks/BlockCard.tsx` (the `motion.div` is a dnd-kit draggable, which sets `role="button"`). Inner controls like World Bank's `Apply` then collide in the accessibility tree — Playwright saw two "Apply" buttons, one of them the entire card (`World Bank World Bank` plus the inner label).
Why it matters: keyboard and AT users get a giant button wrapping other buttons. The persistence e2e had to use `{ name: 'Apply', exact: true }` to escape it.
What I would do: stop promoting the card itself to `role="button"` (dnd-kit `role` option / drag handle only), so inner controls keep unique names.
Fixed: #75 (2026-10-01). `attributes` and `listeners` are spread on the grip only; `e2e/block-a11y.spec.ts` checks the tree.

## Unused ApiConfig on the block schema
Where: `src/core/schemas/block.schema.ts` ~190. A separate `ApiConfig` with an `apiKey` field. Nothing imports it.
Why it matters: a second type named ApiConfig next to `api.schema.ts`'s is how a key field reappears by accident.
What I would do: delete the unused interface.
Fixed: deleted in `0f6c849`, landed with #67. Nothing named `ApiConfig` remains under `src/`.

## Turbopack compile cache can hold inlined env values
Where: `.next/cache/turbopack/**/*.sst` after `next build`. Not the client bundle (`.next/static` was clean).
Why it matters: a machine-local cache is inside the security boundary, but copying `.next` off the machine would copy it.
What I would do: keep `.next` gitignored (it is). Do not treat cache hits as a client leak.
