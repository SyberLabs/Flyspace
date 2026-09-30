> **Status (2026-09-29):** historical — the Shell Store shipped and grew past this plan (Investor, Researcher, and World Watch templates in `src/core/shells/templates.ts`, wires as `DataWire` rather than `connections`), so its "parked" and "remaining" items no longer describe the code. Current roadmap: APEX_PLAN.md.

# Citadel — Shell Store Build Plan

> Front: **Citadel** (active). Created 2026-06-19.
> Goal: ship a **Shell Store** of preconfigured, opinionated thinking environments that
> demonstrate the Citadel's value on first open — solving the blank-canvas problem.
> First template: **Investor Shell**, built end-to-end to define the template format.

---

## Why this, why now

The Citadel's hardest problem is the blank canvas: "wire up data + personas" assumes the
user already knows what to build. The Shell Store inverts that — each named shell is an
*opinionated claim about a workflow* ("Investor", "Researcher", "Creative"), shipped ready
to think in. It also gives the Citadel front a concrete, shippable spine.

## Decisions (locked 2026-06-19)

- **First shell:** Investor — it ships entirely on **existing** registered blocks (zero new
  normalizers), so it proves the store concept without block-building distraction.
- **Instantiate behavior:** picking a template **spawns a new shell** (a working copy); the
  built-in template stays pristine.
- **Authoring/storage:** built-ins are **code-defined** — a typed `SHELL_TEMPLATES` const.
  (User-authored "save as template" can come later via the existing Save flow.)

## What already exists (so we build, not rebuild)

- `ShellType` already includes `'template'`; `ShellConfig` carries `blocks`, `connections`,
  `persona`, `aesthetic`, `description`, `templateTags`, `isTemplate`.
- `ShellPanel` **already renders a "Templates" section** (`shells.filter(s => s.type==='template')`).
- `duplicateShell(sourceId, name)` already creates a **new `custom` shell from a source** — this
  *is* the "spawn from template" semantics. `loadShell` rebuilds blocks from `BlockRegistry`.
- **Gap:** nothing seeds any `type:'template'` shell. The shelf is built; it's empty.

## Investor Shell — block manifest (all exist today, verified)

| block_id | Role in the shell |
|---|---|
| `fred_series` | Macro: GDP, rates, inflation (the "macroeconomic data") |
| `bls_series` | Employment / CPI |
| `worldbank_indicator` | Global macro indicators |
| `alpha_vantage_quote` | Equity quotes (the "yfinance" need) |
| `coingecko_crypto` | Crypto prices |
| `polymarket_live_odds` | Event probabilities |
| `metaculus_forecast` | Forecasts |
| `newsapi_feed` | Market-relevant news |
| `persona_analyst` | Pattern recognition over the data |
| `persona_strategist` | Positioning / what-to-do |

Default wiring: data blocks → Analyst; Analyst (+ key data) → Strategist. (Exact layout/wires
finalized in step 2.)

---

## Build steps

### Step 1 — Template format + registry (the reusable core) ✅ DONE (2026-06-19)
Built `src/core/shells/templates.ts`: `ShellTemplate`/`TemplateBlock`/`TemplateConnection`
types (templates use local `ref`s remapped to fresh instance ids on instantiate),
`SHELL_TEMPLATES` with the Investor shell (10 blocks, 11 wires), `getShellTemplate`, and
`validateTemplate`/`validateAllTemplates`. Integrity test (`templates.test.ts`, 7 tests)
validates the Investor shell against the **real** `blockRegistry` — fails loudly if a template
names an unknown block or wires a missing ref. 49 tests / tsc / lint / build all green.
_Note: chose NOT to persist built-ins into the shell store (avoids localStorage re-seed dupes);
Step 3 instantiates from the static `SHELL_TEMPLATES` source instead._

<details><summary>original step 1 notes</summary>
- Define `SHELL_TEMPLATES: ShellTemplate[]` in `src/core/shells/templates.ts` (new).
  - A `ShellTemplate` is a `ShellConfig`-shaped definition with `type:'template'`,
    `isTemplate:true`, a `templateTags` list, and `blocks` referencing **registry block_ids**
    with positions + `connections`.
  - Validation helper: every referenced `block_id` must exist in `blockRegistry` (fail loud in
    dev if a template names an unknown block).
- Seed built-in templates into the shell store on init (mirror how system shells seed). Built-ins
  are presented but never mutated; they live alongside user shells as `type:'template'`.
- **Verify:** templates appear in `ShellPanel`'s existing Templates section.
</details>

> **Note:** Step 2 (authoring the Investor template content) was completed together with
> Step 1 — the template is fully defined in `templates.ts`. Remaining: Step 3 (instantiate
> action) and Step 4 (store presentation).

### Step 2 — Author the Investor template (the content) ✅ DONE (folded into Step 1)
- Lay out the 10 blocks with sensible positions (grouped: macro cluster, markets cluster,
  signals cluster, personas on the right).
- Define the default wires (data → Analyst → Strategist) using the existing `connections` shape.
- Set `persona: 'analyst'`, a fitting `aesthetic`, a crisp `description` + `templateTags`
  (`['finance','markets','macro']`).
- **Verify:** by reading it back — block_ids resolve, wires reference valid block instances.

### Step 3 — "Spawn from template" action ✅ DONE (2026-06-19)
Added `instantiateTemplate(template, name?)` to the shell store: remaps each template
block's local `ref` to a fresh unique instance id, rebuilds connections against those ids,
writes a `type:'custom'` `ShellConfig`, then reuses the tested `loadShell` to populate +
activate the canvas. Built-in templates stay pristine (static source, never mutated); each
use spawns an independent copy. `ShellPanel` now has a **"Shell Store"** section listing
`SHELL_TEMPLATES` with description/tags and a **"Use this shell"** button. 5 store tests
(fresh ids, remapped connections, independent copies, persona/aesthetic, custom name) +
54 total / tsc / lint / build green. Live: app compiles & serves the new panel with no
errors. _(Visual click-through of the populated canvas is the one piece left to the user.)_

<details><summary>original step 3 notes</summary>
- Wire the template card's primary action to **create a new shell from the template**, reusing
  `duplicateShell` (or a thin `instantiateTemplate(templateId)` that calls the same machinery),
  then `loadShell` the new shell so the canvas populates and activates.
- Result: user clicks "Investor" → a fresh "Investor Shell" (custom) opens populated + wired;
  the built-in template is untouched.
- **Verify (live):** click → canvas shows all 10 blocks wired; editing/deleting does not alter
  the template; picking again spawns another independent copy.
</details>

### Step 4 — Store presentation polish (minimal) ✅ mostly DONE (folded into Step 3)
The Shell Store section already shows a TEMPLATE badge, `description`, `tags`, and a primary
"Use this shell" button. Remaining (optional): an icon per template, and deciding whether the
store graduates to its own surface. Low priority — the shelf works.

### Step 5 — Verify + commit
- `tsc` + `npm test` + `lint` + `build` all green (the CI gates from Phases 2/5).
- Live smoke: open store → spawn Investor → confirm blocks load and data fetches (mock mode is
  fine; real data needs keys per `.env`).
- Add a unit test: `SHELL_TEMPLATES` integrity (every referenced block_id exists in the registry;
  every connection references a block present in the same template).
- Commit. (Optional: a screenshot/`/verify` pass.)

---

## Explicitly out of scope (parked)

- **Researcher / Creative shells** — built after Investor proves the format. Researcher needs an
  arXiv block (cheap, lane-1) and parks Obsidian (lane-2, local files). Creative needs new
  *interactive-tool* blocks (lane-3) — the shell that earns a new block kind.
- **User "save as template"** — the existing Save flow can grow this later; not needed for built-ins.
- **New data blocks** — the Investor shell deliberately uses only what's registered.

## The ladder this sets up (future, not now)

1. **Investor** — assemble existing blocks → proves the store. *(this plan)*
2. **Researcher** — store + 1 new lane-1 block (arxiv) → proves the store absorbs new blocks.
3. **Creative** — store + new interactive block kind → earns the lane-3 expansion.

## Open design notes (decide while building, not blocking)

- Does "spawn" name copies `Investor Shell`, `Investor Shell (2)`, …? (duplicateShell already
  appends "(Copy)" — pick a nicer scheme.)
- Should the Store be its own surface or stay inside the existing Shell Manager panel? (Start
  inside the existing panel; promote to its own surface only if it earns it.)
