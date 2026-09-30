> **Status (2026-09-29):** historical — the gap it was written to close is closed; persona turns run through `src/core/services/personaTurn.service.ts` and no longer use the `setTimeout` placeholders described here. Current roadmap: APEX_PLAN.md.

# Citadel — Think Loop Build Plan

> Front: **Citadel** (active). Created 2026-06-19.
> Goal: make the Citadel's core differentiator real — **wire live data into a persona
> block, hit Think (or chat), and get a grounded LLM insight that cites its sources.**

---

## The finding that motivates this

The loop is **~90% built and severed at the last inch.**

- ✅ **Data half is real.** `extractBlockData` (`wire.service.ts`) formats Polymarket /
  News / text / code / list blocks into prompt-ready strings. `aggregateWireContext(id)`
  returns `{ context, sourceIds, lastUpdate }` from wired blocks + shell-mind context.
- ✅ **LLM half is real.** Server-proxied `/api/llm` (Phase 3); `getLLMService(config)` with
  `complete` / `stream` / ping-based `isAvailable`. `mind.engine.ts` already uses it correctly.
- ❌ **They are NOT connected.** In `src/blocks/persona/PersonaBlock.tsx`, `handleSendMessage`
  and `handleThink` are `setTimeout` placeholders returning **hardcoded fake text**. They never
  call the LLM; `handleSendMessage` doesn't even call `aggregateWireContext`.

So: not a polish, a **build** — but a small, well-scoped one (connect two existing real halves).

## Success criteria

A user opens the Investor shell, ensures a provider is available (Ollama running, or a key in
`.env`), types a question into the Analyst (or hits Think), and gets a **streamed, real LLM
response that demonstrably reflects the wired data** (e.g. references the actual market/news
values), with the source blocks attributed. Failure (no provider) degrades to a clear message,
not a crash or a fake answer.

---

## Build steps

### Step 1 — A reusable persona-think service
- Add `src/core/services/persona.engine.ts` (or extend `mind.engine.ts`) with one function,
  e.g. `runPersonaTurn({ instanceId, personaType, userMessage? })`, that:
  1. reads `llmConfig` from `useMindStore`,
  2. builds the system prompt from the persona (`getPersonaSystemPrompt` / `PERSONA_CONFIGS`),
  3. gathers wired context via `aggregateWireContext(instanceId)`,
  4. assembles messages: `[system, ...recentHistory, {user: question OR a default
     "analyze the connected data" task}]` with the context injected,
  5. checks `getLLMService(llmConfig).isAvailable()` (ping), and
  6. streams via `llm.stream(messages)` (fallback to `complete`).
- Mirror `mind.engine.ts`'s call pattern exactly (it's the proven reference).
- **Why a service, not inline:** chat and Think share 95% of this; both call it.

### Step 2 — Wire `handleSendMessage` to it (real chat)
- Replace the `setTimeout` mock: push the user message, set `isThinking`, then stream the
  assistant reply token-by-token into the message (live update of `personaData.messages`),
  attributing `sourcedFrom: aggregateWireContext(instanceId).sourceIds`.
- On no-provider: append a clear "‹persona› can't reach an LLM — start Ollama or set a key in
  .env" message instead of a fake one.

### Step 3 — Wire `handleThink` to it (autonomous analysis)
- Same path with no `userMessage` (uses the default "analyze the connected data" task), so
  Think produces a genuine, context-grounded observation rather than the canned bullet list.

### Step 4 — Loose ends
- Remove the placeholder copy and the `console.log` in `toggleCollapsed`.
- Ensure `currentContext` refreshes before a turn (call `handleUpdateContext` or inline it) so
  the model sees fresh wired data.
- Decide: does a streamed persona response also post to the shell-mind `observations` pool
  (like `mind.engine`)? Default: yes for Think, no for chat (avoid noise) — match existing intent.

### Step 5 — Tests + live verification
- Unit: mock `getLLMService` (or the fetch) and assert `runPersonaTurn` (a) injects the wired
  context into the prompt, (b) includes the persona system prompt, (c) returns the streamed
  text, (d) fails closed with a clear message when `isAvailable` is false. (No real network.)
- `tsc` / `npm test` / `lint` / `build` green.
- **Live (needs a provider):** Investor shell → ask the Analyst about the wired markets →
  confirm the answer reflects real data + streams + attributes sources. This is the one the
  user drives with a real ANTHROPIC_API_KEY / GOOGLE_API_KEY (per decision) or Ollama.

---

## Out of scope (parked)
- Persona-to-persona wiring as a *generation* trigger (Analyst → Strategist auto-run). The
  Investor shell wires it structurally; auto-cascading a Think down the chain is a follow-on.
- Memory crystallization (insight → new wired block).
- More shell templates (Researcher/Creative) — gated on this loop being genuinely good.

## Risks / notes
- The persona-block path and the Mind-panel path now both call the LLM; keep them consistent
  (shared service) so they don't drift — this also nibbles at the parked "two Mind engines"
  question without resolving it.
- Streaming into Zustand on every token can be chatty; update on a throttled cadence or
  accumulate then set, as `SystemMindChat` does, to avoid re-render storms.
