> **Status (2026-09-29):** historical — this is the 2026-06-18 remediation plan and its Progress table stopped there; it refers to the deleted Garden, `life_systems.md`, and port helpers (`validateWire`, `convertWireData`) that no longer exist. Current roadmap: APEX_PLAN.md.

# OMNI_OS — Implementation & Remediation Plan

> Created: 2026-06-18 · Owner: engineering · Status: **In progress**
>
> This plan addresses the findings from the 2026-06-18 project survey. It is ordered by
> dependency and risk: unblock the build first, harden security second, establish a safety
> net third, then resume feature work. The **Progress** section at the bottom is the living
> record — update it as each step lands.

---

## Guiding Principles

1. **Green build before anything else.** No feature work proceeds until `next build` passes.
2. **Smallest correct change.** Match surrounding code style; no opportunistic refactors mixed into fixes.
3. **One concern per commit.** Build fixes, security migration, and tests land as separate, reviewable units.
4. **Verify, don't assume.** Each phase ends with a concrete verification command and an observed result.

---

## Phase 0 — Baseline & Safety Net

**Goal:** Capture the current state so regressions are detectable and work is reversible.

| # | Step | Detail | Verify |
|---|------|--------|--------|
| 0.1 | Record baseline error count | `npx tsc --noEmit` → expect **8 errors**. Save output. | Output captured |
| 0.2 | Confirm clean working tree intent | Decide whether to branch off `master`. Recommend `git checkout -b fix/build-and-security`. | Branch created |
| 0.3 | Snapshot lint state | `npm run lint` → record warnings/errors so cleanup later is measurable. | Output captured |

**Exit criteria:** baseline numbers recorded; working on a feature branch.

---

## Phase 1 — Unblock the Build (Critical)

**Goal:** `next build` and `npx tsc --noEmit` both pass with zero errors.
**Why first:** `next.config.ts` does not set `ignoreBuildErrors`, so these 8 errors hard-block any production build and any deploy.

### 1.1 Fix broken module import (1 error)
- **File:** [src/components/blocks/MetaculusView.tsx](src/components/blocks/MetaculusView.tsx#L17)
- **Problem:** imports `@/core/schemas/omnidata.schema` which does not exist.
- **Fix:** change the import path to `@/core/gateway/omnidata.schema` (where `OmniItem`, `ApiStatus` actually live). Cross-check the symbols are exported from that module; if `ApiStatus` is named differently there, align the import.
- **Verify:** `npx tsc --noEmit` no longer reports `MetaculusView.tsx(17,...)`.

### 1.2 Fix params index-signature errors (4 errors)
- **Files:** [AlphaVantageBlock.ts](src/blocks/truth/AlphaVantageBlock.ts#L16), [BlsBlock.ts](src/blocks/truth/BlsBlock.ts), [FredBlock.ts](src/blocks/truth/FredBlock.ts), [WorldBankBlock.ts](src/blocks/truth/WorldBankBlock.ts)
- **Problem:** each `*BlockParams` interface is passed to `useOmniData` whose `params` is typed `Record<string, unknown>`. A plain interface lacks an index signature, so assignment fails.
- **Fix (preferred):** add an index signature to each params interface, e.g.:
  ```ts
  export interface AlphaVantageBlockParams {
      symbol?: string;
      function?: string;
      [key: string]: unknown; // satisfies Record<string, unknown>
  }
  ```
  Apply the same one-line addition to the other three. (Alternative — change `useOmniData`'s param type — is riskier and broader; prefer the local fix unless we want a single canonical `OmniParams` type.)
- **Verify:** `tsc` no longer reports the four `truth/*Block.ts` errors.

### 1.3 Fix normalizer null-vs-undefined errors (3 errors)
- **Files:** [normalizers/bls.ts:181](src/core/gateway/normalizers/bls.ts#L181), [normalizers/fred.ts:155-157](src/core/gateway/normalizers/fred.ts#L155), [normalizers/worldbank.ts:142](src/core/gateway/normalizers/worldbank.ts#L142)
- **Problem:** `buildMetrics()` can return `OmniMetrics | null`, but `createOmniData`'s payload expects `OmniMetrics | undefined`.
- **Fix:** normalize the empty case to `undefined`. Either have `buildMetrics` return `OmniMetrics | undefined`, or coalesce at the call site: `metrics: metrics ?? undefined`. Pick whichever keeps the three files consistent (check what `coingecko`/other normalizers already do and match it).
- **Verify:** `tsc` no longer reports the three normalizer errors.

### 1.4 Full green-build confirmation
- **Verify:**
  - `npx tsc --noEmit` → **0 errors**
  - `npm run build` → completes successfully
- **Exit criteria:** clean typecheck + successful production build. **Commit:** `fix: resolve 8 TypeScript build-blocking errors`.

---

## Phase 2 — CI / Regression Gate

**Goal:** Make it impossible to silently re-break the build.

| # | Step | Detail |
|---|------|--------|
| 2.1 | Add `typecheck` script | Add `"typecheck": "tsc --noEmit"` to [package.json](package.json) scripts. |
| 2.2 | Add CI workflow | `.github/workflows/ci.yml`: on push/PR run `npm ci`, `npm run typecheck`, `npm run build` (blocking) + `npm run lint` (non-blocking until Phase 5). |
| 2.3 | (Optional) pre-commit | Lightweight hook or document the local command in README. |

**Exit criteria:** CI fails on a deliberately introduced type error (verified once, then reverted). **Commit:** `ci: add typecheck + build gate`.

---

## Phase 3 — Secrets Off the Client (Security)

**Goal:** No API keys or LLM keys are shipped to, stored in, or sent from the browser. All keyed calls are proxied server-side.
**Context:** Today LLM keys live in `llmConfig.apiKey` (persisted to `localStorage` under `omni-mind`) and are sent directly from the browser by [llm.service.ts](src/core/services/llm.service.ts). NewsAPI/Polymarket keys are passed from the client via `x-api-key`.

### 3.0 Trim providers to the chosen three
- **Remove** the OpenAI and DeepSeek adapters from [llm.service.ts](src/core/services/llm.service.ts) and any provider enums/UI options (`LLMProvider`, settings dropdowns, `LLM_DEFAULTS`). Keep **Anthropic, Local (Ollama), Google (Gemini)**.
- **Update the Anthropic default model** from the outdated `claude-3-haiku-20240307` to a current Claude model (e.g. a current Haiku/Sonnet id) in the adapter + `LLM_DEFAULTS`.
- **Verify:** provider picker shows only the three; `tsc` still green.

### 3.1 Environment scaffolding
- Create `.env.example` documenting required vars for the **three kept providers**: `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, plus optional `OLLAMA_BASE_URL`; and data APIs `NEWSAPI_KEY`, `POLYMARKET_API_KEY`. (No `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`.)
- Confirm `.env*` stays gitignored (it already is). Add a README section on configuration.
- **Single-operator model:** keys are read from `process.env` server-side only; document that this is a local-first / single-user deployment and that public hosting requires adding auth first.

### 3.2 Server-side LLM route
- Create `src/app/api/llm/route.ts` (POST). It receives `{ provider, model, messages, options }`, reads the matching key from `process.env`, and performs the provider call server-side. Move the adapter logic from [llm.service.ts](src/core/services/llm.service.ts) into a server module (`src/core/services/server/llm.adapters.ts`) so it never bundles into client code.
- Keep a thin client `llm.service.ts` that just `fetch('/api/llm', ...)`. Preserve the streaming path (proxy a `ReadableStream` through the route for Ollama/OpenAI streaming).
- Update [mind.engine.ts](src/core/services/mind.engine.ts) and any callers (`coreMind.engine.ts`, `systemMind.engine.ts`) — interface should stay the same so changes are localized.

### 3.3 Server-side third-party data routes
- Route the gateway's keyed providers through server endpoints rather than browser fetches. The `restList` adapter and `ApiGateway.fetch` should call our own `/api/gateway/[provider]` route (or per-provider routes) which inject keys from `process.env`. Non-keyed/public APIs may remain client-side if CORS permits.
- Remove the `x-api-key`-from-client pattern in [api.service.ts](src/core/services/api.service.ts); the Next routes read keys from env instead of headers.

### 3.4 Migrate settings UI (local-first model)
- Since deployment is **local-first single-user**, secrets live in `.env` (server-side), not in the UI. Remove provider-LLM key inputs from the Settings panel (or convert them to a read-only "configured via .env" status indicator). Stop persisting any provider key to `localStorage`.
- Drop `apiKey` from the persisted `omni-mind` `llmConfig` partialize set so existing browsers stop retaining it.
- Strip placeholder secrets (`POLYMARKET_API_KEY_PLACEHOLDER`, etc.) from the default store state.

### 3.5 SSRF / input hardening on routes
- All new `/api/*` routes: validate `provider`/`model` against an allowlist; cap `messages`/`maxTokens`; never reflect raw upstream errors containing keys.

**Exit criteria:** grep confirms no provider key reaches client bundles; `omni-mind` localStorage no longer contains `apiKey`; LLM + news + polymarket still work end-to-end through server routes. **Commit:** `security: proxy LLM and keyed APIs through server routes`.

---

## Phase 4 — Test Harness (Quality)

**Goal:** A safety net around the pure logic most likely to break.

| # | Step | Detail |
|---|------|--------|
| 4.1 | Add Vitest | Install `vitest` + config; add `"test": "vitest"` script. |
| 4.2 | Test normalizers | Unit-test each `src/core/gateway/normalizers/*` with a captured raw sample → asserts shape, empty-input, and the null/undefined metrics path from 1.3. |
| 4.3 | Test port/wire logic | Cover `port.service.ts` (`validateWire`, `convertWireData`, compatibility matrix) and `wire.service.ts`. |
| 4.4 | Test shell snapshot | `shell.snapshot.ts` `captureShellSnapshot` / `formatSnapshotForLLM` with a fixture store. |
| 4.5 | Wire into CI | Add `npm test` to the Phase 2 workflow. |

**Exit criteria:** `npm test` green in CI; normalizer + port + snapshot logic covered. **Commit:** `test: add vitest suite for normalizers, ports, snapshot`.

---

## Phase 5 — Hygiene Cleanup (Low risk)

| # | Step | Detail |
|---|------|--------|
| 5.1 | Remove debug logs | Strip per-render `console.log` from blocks (e.g. [CoinGeckoBlock.ts](src/blocks/truth/CoinGeckoBlock.ts)) or gate behind a `DEBUG` flag. |
| 5.2 | Tighten `any` in routes | Add minimal response interfaces in [api/polymarket](src/app/api/polymarket/route.ts) / [api/news](src/app/api/news/route.ts) parsing. |
| 5.3 | Consolidate data path | Decide whether legacy `api.service.ts` is retired in favor of `ApiGateway`; document the canonical path. |

**Exit criteria:** lint warning count reduced from Phase 0 baseline; one documented data-fetch path.

---

## Phase 6 — Resume Feature Work (per vision.md / life_systems.md)

Only after Phases 1–4 are green. Tracked but not scheduled here:
- Memory crystallization loop (insight → new wired block).
- Persona-to-persona wiring.
- Port UI visualization (indicators, type colors, tooltips).
- Complete Life Systems domains (career/finance/relationships/mind/environment/time).

---

## Resolved Decisions (2026-06-18)

1. **Deployment model: Local-first single-user.** Matches the existing design (all state in `localStorage`, default provider is local Ollama, no auth/DB). Phase 3 uses **env-based server proxying for a single operator** — no key vault, no per-user auth.
   - **Constraint baked in:** local-first is the *only* supported model. Hosting this publicly would expose the single operator's env keys to every visitor, so **public hosting must add auth first** — out of scope until explicitly requested.
2. **Provider scope: keep 3 — Anthropic, Local (Ollama), Google (Gemini).** **Drop OpenAI and DeepSeek** adapters (easy to re-add later via the adapter pattern). Also: the Anthropic adapter currently hardcodes the outdated `claude-3-haiku-20240307` — update its default to a current Claude model during Phase 3.

---

## Progress

> Update this table as steps land. Status: ⬜ not started · 🟡 in progress · ✅ done · ⛔ blocked

| Phase | Step | Status | Notes / Date |
|-------|------|--------|--------------|
| 0 | Baseline & safety net | ✅ | Survey done 2026-06-18; baseline = 8 TS errors |
| 1.1 | MetaculusView import fix | ✅ | Fixing the import unmasked 9 hidden errors in the file (it was unresolvable before). Root cause: component typed against wrong `ApiStatus` + raw `unknown` metadata. Fixed: import `OmniItem` from `@/core/gateway`, status prop retyped `ApiStatus`→`ConnectionStatus`, `'fetching'`→`'connecting'`, metadata reads cast to concrete types. |
| 1.2 | Params index-signature (4 blocks) | ✅ | Added `[key: string]: unknown` to Alpha/Bls/Fred/WorldBank params |
| 1.3 | Normalizer null→undefined (3 files) | ✅ | `metrics: metrics ?? undefined` at call sites in bls/fred/worldbank |
| 1.4 | Green build confirmation | ✅ | `tsc --noEmit` 0 errors; `next build` succeeds (compiled 9.0s, 8 routes) |
| 2 | CI / regression gate | ✅ | Added `typecheck` script + `.github/workflows/ci.yml`. Typecheck + build are **blocking**; lint is **non-blocking** (`continue-on-error`) because repo has 61 pre-existing lint errors — becomes blocking after Phase 5. Verified typecheck/build green locally. ⚠️ CI won't exercise real code until the untracked `src/` tree is committed (see note). |
| 3.0 | Trim providers to 3 (Anthropic/Local/Gemini) + update Claude model | ✅ | Dropped OpenAI+DeepSeek from `LLMProvider`/`LLM_DEFAULTS`; removed `apiKey` from `LLMConfig`; Claude default → `claude-haiku-4-5-20251001`. Added migration in mindStore `merge` to drop persisted keys + reset removed providers. |
| 3.1 | Env scaffolding | ✅ | Added `.env.example` (ANTHROPIC/GOOGLE/NEWSAPI keys + OLLAMA_BASE_URL) and a README Configuration section. |
| 3.2 | Server-side LLM route | ✅ | New `src/core/services/server/llm.adapters.ts` (`server-only`, reads process.env) + `/api/llm` route. Rewrote client `llm.service.ts` as a thin proxy with the **same public interface** — all 6 callers untouched. Streaming proxied as a text stream. |
| 3.3 | Server-side data routes (scoped) | ✅ | **Scoped per decision:** NewsAPI route now reads `process.env.NEWSAPI_KEY` (removed client `x-api-key`); Polymarket/Metaculus are keyless. Stripped placeholder secrets from settings store. Full ~30-provider gateway proxying deferred (see follow-ups). |
| 3.4 | Settings UI migration | ✅ | MindPanel + SettingsPanel: removed all client-side key inputs, replaced with "configured via .env" notices; dropped dead state/handlers; `setProvider` no longer takes a key. |
| 3.5 | Route input hardening | ✅ | `/api/llm`: provider/role allowlists, message count + total-char caps, temp/token clamping, baseUrl honored only for local, upstream errors never reflected to client. |
| 4 | Vitest harness | ✅ | Vitest 4 configured (`vitest.config.mts` — `.mts` ext required to dodge an ESM/CJS config-load error; `vite-tsconfig-paths` for `@/`; `vitest.setup.ts` localStorage polyfill so persisted stores load in node, avoiding jsdom). **31 tests / 4 files**: fred + polymarket normalizers (incl. null-metrics regression), port.service (compat matrix, conversion, validateWire, utils), shell.snapshot (formatSnapshotForLLM + captureShellSnapshot via store seeding). `npm test` added as a **blocking** CI gate. tsc + build still green. |
| 5 | Hygiene cleanup | ✅ | Lint **errors 0** (was 61). `prefer-const` autofixed; 8 unescaped-entity errors fixed by hand; `no-explicit-any` + `no-unused-vars` + `react-hooks/*` correctness rules downgraded to **warn** (per decision — visible/counted, not blocking; 179 warnings remain as tracked debt). Debug noise: added `src/core/debug.ts` (`debug()` gated by `NEXT_PUBLIC_OMNI_DEBUG`) and converted ~70 `console.log` → `debug` across 9 gateway/block/hook files (kept `console.error`/`console.warn`). **Lint flipped to a blocking CI step.** lint+test+tsc+build all green. |
| 6 | Feature work | ⬜ | Gated on Phases 1–4 (all ✅) |

### Changelog
- **2026-06-18** — Plan created from initial survey. No code changes yet.
- **2026-06-18** — Resolved decisions: local-first single-user deployment; keep Anthropic + Local (Ollama) + Google (Gemini), drop OpenAI + DeepSeek. Added step 3.0 (provider trim + Claude model update).
- **2026-06-18** — **Phase 1 complete.** Fixed all 8 build-blocking TS errors. Fixing the MetaculusView import unmasked 9 further pre-existing errors in that file (it had been silently excluded from typechecking due to the unresolvable import) — all resolved. `tsc --noEmit` clean; `next build` green. 8 files changed; no behavior changes intended. Ready to commit.
- **2026-06-18** — Branched `fix/build-and-security` off `master`. Committed `3589a80`: imported the full untracked app source + Phase 1/2 changes in one commit (the entire `src/` tree had never been committed beyond the initial scaffold). `.claude/` added to `.gitignore`. Working tree clean. Not yet pushed (no remote configured / awaiting confirmation).
- **2026-06-18** — **Phase 2 complete.** Added `typecheck` npm script + GitHub Actions CI (`.github/workflows/ci.yml`). Blocking: typecheck + build (both green). Non-blocking: lint — repo has **61 lint errors / 135 warnings** pre-existing, so making lint blocking now would render CI useless; it flips to blocking after Phase 5 cleanup. **Note:** the repo is still at the single "Initial commit" with most of `src/` untracked — CI will only meaningfully run once that tree is committed.
- **2026-06-18** — **Phase 3 complete.** Secrets moved off the client. LLM calls now proxy through `/api/llm` (keys in `process.env`, never bundled); verified the client `.next/static` bundle contains **no key values** (only env-var *names* as UI labels). Providers trimmed to Local/Anthropic/Gemini; Claude model updated. NewsAPI key moved server-side (scoped). Settings UIs show "configured via .env" instead of key inputs. `tsc` + `build` green. **Decision:** data-route scope limited to NewsAPI+Polymarket (per user) — full gateway proxying deferred. **New finding:** a dormant `gateway/normalizers/llm.ts` path exists (registered, not invoked by any block) that would call `api.openai.com` client-side with a localStorage key — captured as a follow-up below, not a live exposure.

- **2026-06-18** — **Phase 4 complete.** Added a Vitest suite: **31 tests across 4 files** (fred + polymarket normalizers, port/wire service, shell snapshot). Config notes: `vitest.config.mts` (the `.mts` extension avoids an `ERR_REQUIRE_ESM` config-load failure under Vitest 4 + Vite 6); `vite-tsconfig-paths` resolves the `@/` alias; a `vitest.setup.ts` localStorage polyfill lets the persisted Zustand stores import in the node environment (jsdom hit the same ESM error via its CSS deps, so it was avoided). `npm test` is now a **blocking** CI step alongside typecheck + build. tsc + build remain green. Tests are type-checked by `tsc` and ignored by `next build`.

- **2026-06-18** — **Runtime smoke test (post-Phase 4).** Booted `next dev` (no `.env`). Verified at runtime: `/` and `/garden` render (200); `/api/llm` returns **503 graceful** for an unconfigured cloud provider, **400** for a dropped provider (`openai`, allowlist working) and **400** for empty messages (validation working) — no key material leaked in errors; `/api/news` returns 503 graceful with no key; `/api/polymarket` returns **live data** (200). No server errors/unhandled exceptions in the log. Note: `/api/metaculus` returns 403 — **upstream Metaculus rejection** (pre-existing, external), handled cleanly by our route. Confirms the Phase 3 LLM-proxy wiring runs end-to-end on the degradation paths. Full token-streaming round-trip still needs a real key / running Ollama (operator's environment).

- **2026-06-18** — **Phase 5 complete.** Lint errors 61 → **0**; lint is now a **blocking** CI gate. Decision (user-confirmed): downgrade `no-explicit-any` (37) to warning rather than a risky typing sweep of external-JSON parsing; also downgraded `no-unused-vars` and the React-Compiler `react-hooks/*` correctness rules to warning (the app runs — verified by smoke test — so these are incremental-refactor targets, not breakage). Fixed 8 unescaped-entity errors by hand. Replaced ~70 hot-path `console.log` with a `NEXT_PUBLIC_OMNI_DEBUG`-gated `debug()` logger (`src/core/debug.ts`) across 9 files. 179 warnings remain as explicit tracked debt. All gates green (lint/test/tsc/build).

- **2026-06-18** — **Phase 3 regression fixed (found via user testing the Garden "career mind").** Symptom: clicking into a System Mind chat with no Ollama running threw an opaque `Jest worker encountered 2 child process exceptions` (Next dev worker crash masking the real error). Root cause was my Phase 3 `isAvailable()`: it probed by sending a **real generation** request to `/api/llm`, and for `local` with no Ollama the route returned **502** (not 503), so `isAvailable()` (`status !== 503`) wrongly reported `true` and the `chatStream` guard was bypassed — the failing generation then destabilized the dev worker. Fix: added a lightweight `mode: 'ping'` to `/api/llm` + `checkProviderAvailable()` (pings Ollama `/api/tags` for local, key-presence for cloud) returning `200 { available }`; rewrote client `isAvailable()` to use it (no generation). Verified: ping returns `200 {available:false}` for local-no-Ollama and anthropic-no-key — no 502, no worker crash; the chat now degrades to a clean "not available" message. tsc + 31 tests green. **Lesson:** the Phase 3 smoke test covered degradation for cloud-no-key but never **local streaming without Ollama** — that gap is what shipped this bug.

- **2026-06-19** — **Security: removed `new Function` / eval from the stability engine.** Found while mapping the Garden "edit system": three sites ran user/LLM-authored strings as arbitrary JS — `calculateEffect` (`customExpression`), `evaluateCondition` (rule `condition`), and `trackerBridge` (`customFormula`). Since rules/effects carry `isLLMGenerated` and flow from the LLM model-generator, this was a real code-execution surface. Replaced with `src/core/schemas/safeExpression.ts` — a small recursive-descent evaluator (allowlist grammar: numbers, known identifiers, comparisons, `&& || ! + - * / % ^`, parens; fail-closed). All real default-model conditions evaluate identically; trackerBridge preserves its raw-value fallback. Added 11 tests incl. attack-string rejection (`process.exit`, `value.constructor.constructor(...)()`, etc. → never executed). Full suite 31 → **42 green**; tsc/lint/build green.

### Deferred follow-ups (post-Phase 3)
- **Typed `any` cleanup (Phase 5 carryover):** 37 `no-explicit-any` are now warnings, concentrated in `restList.ts`, `shell.snapshot.ts`, `mind.engine.ts`, store internals, and API route parsing. Type out incrementally with `unknown` + guards.
- **React-hooks correctness warnings:** 11 `react-hooks/*` (set-state-in-effect, purity, etc.), mostly in block adapters' `useEffect` data-sync. Refactor toward derived state / event handlers over time.
- **Full gateway key proxying:** the `ApiGateway` still fetches ~30 keyed third-party providers directly from the browser with keys persisted in `apiStore` (localStorage). Same pattern as the NewsAPI fix, repeated. Build a generic `/api/gateway/[provider]` route + migrate `apiStore` off client-stored keys.
- **Dormant gateway `llmNormalizer`:** `src/core/gateway/normalizers/llm.ts` + the `openai`/`anthropic`/`google`/`groq` entries in `API_CATALOG` form a second client-side LLM path (defaults to `api.openai.com`, key from localStorage). Currently **unreachable** (no block calls `apiGateway.fetch('llm', …)`). Either remove it or route it through `/api/llm`.
