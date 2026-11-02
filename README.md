<p align="center"><img src="docs/assets/flyspace-logo.jpg" width="120" alt="Logo: five layered white strokes sweeping like a wing, on black"></p>

<h1 align="center">Flyspace</h1>

A canvas over live data. Drop **blocks** that pull real numbers - prediction
markets, economic series, crypto, news, research - and wire them together.

This repo is what runs at https://omni.syberlabs.io, a keyless public preview.
Personas appear on the canvas, but AI answers are off: the code that called a
model, and every other server backend the preview could not reach, was deleted
on 2026-11-02 (last present at commit `8a21350`).

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No keys are needed: every
built-in data source is public (Polymarket, CoinGecko, Hacker News, World Bank,
OpenAlex, and others).

## The idea

A block is a live view of one source. A wire says *this feeds that*.

Shells are saved canvases. The Shell Store spawns pre-wired ones; the
**Investor** shell arrives with its blocks and wires already connected.

## Capability compiler

An unknown API can be compiled into a native block instead of hand-written. The
compiler in `src/core/capabilities/` turns an OpenAPI document into a
`CapabilityManifest`.
`installProposal` is the only gate that registers one. Write and destructive
capabilities stay `pending` until `approveCapability`, and a manifest never
grants itself authority. Execution has idempotency keys and reports
`EFFECT_UNCERTAIN` when a write may have left the process. See
`src/core/capabilities/DESIGN.md`. Claim ceiling: this is tested against
fixtures and stubbed transports; no third-party API has been measured in
production use.

## Spoken canvas control

Hold **Talk** or Space and say a command from a fixed grammar ("wire hacker news
to the analyst", "delete this", "undo"). Speech and pointer input only
propose commands; the interaction engine (`src/core/interaction/`) decides. It
refuses unknown or ambiguous names, previews a delete until you confirm, and
supports undo. Claim ceiling: tested with typed-in transcripts; there is no live
microphone measurement of recognition accuracy or latency.

## Development

```bash
npm run typecheck   # tsc, 0 errors
npm run lint        # eslint, 0 errors (warnings are tracked debt)
npm test            # vitest
npm run build       # the Workers bundle that deploys (vinext); dist/
npm run scan:bundle # no secret reached dist/client (build first)
npm run build:next  # the Next server the e2e harness drives
npm run test:e2e    # playwright golden path (needs npm run build:next first)
```

Node version comes from `.nvmrc`, which CI reads too, so local and CI cannot
drift apart.

CI runs three jobs on every push and pull request:

| Job | What it proves |
|-----|----------------|
| Typecheck, Test & Build | the five checks above, including the Playwright golden path |
| Client bundle carries no secrets | builds with a canary value per secret env var, fails if one reaches `dist/client` |
| Dependency audit | production deps block on `high`; dev-only advisories are advisory |

`npm run scan:bundle` is the interesting one - it is the check that used to be
a grep someone had to remember. See `DEPLOYMENT.md`.

## Not in this repo

- **The agent surface** - keyless local browser automation, `/surface` and
  `/api/agent` - moved to
  [SyberLabs/omni-agent](https://github.com/SyberLabs/omni-agent) on
  2026-09-01. It shared no module with the canvas.
- **Model answers, the inference ledger, the capability broker, OAuth sign-in,
  remote speech** - deleted on 2026-11-02 because no deployment reaches them.
  See `APEX_PLAN.md` §7. To bring one back, start from `8a21350`.
- **The Garden and the life OS** - `/garden`, life-system domains, stability
  and equilibrium modelling - deleted on 2026-09-01. It was a second product
  in the same repo, ~15k lines whose value was gated on history that was
  never built. See `APEX_PLAN.md` §5.

## Docs

`APEX_PLAN.md` is the live roadmap. `vision.md` is the north star.
`TYPED_PORT_SYSTEM.md` covers the port layer (declared ports are enforced when a
wire is created; blocks without ports stay untyped).
`AGENTS.md` holds the rules for agents working in this repo.
`DEPLOYMENT.md` records how the preview ships and what CI guarantees.
