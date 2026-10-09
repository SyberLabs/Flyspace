# Deployment

**Status: CI builds, scans and stages the Workers bundle; CD is not built. The
limited public preview is deployed by hand to https://omni.syberlabs.io on
Cloudflare Workers (below), first on 2026-10-03 from `35260bd`. The full app
has no public deployment.**

This records the decision so it does not get re-argued from scratch, and lists
what has to be true before OmniOS is reachable from anywhere but your own
machine.

## The decision

The full OmniOS app goes on a **private network** - Tailscale, WireGuard, or
an IP allowlist - until the controls below are implemented. A limited public
preview is possible with `OMNI_PUBLIC_DEMO=1`: server routes then disable
paid text generation and shared inference ledger reads.

The app's local-first mode has no account system. Production now defaults to
hosted API authentication for inference and its ledger; `OMNI_DEPLOYMENT_MODE=local`
is an explicit single-user opt-in and is safe only on loopback or a private
network with a trusted boundary. Never set local mode on a public listener.
Other API surfaces still need their own hosting review before any public URL:

| Route | Historical anonymous behavior before hosted-boundary changes |
|-------|-------------------------------|
| `POST /api/llm` | Spends your Anthropic / Google credits, unmetered |
| `GET /api/inference-runs` | Reads `prompt_excerpt` and `output_excerpt` from every run |
| `GET /api/inference-runs/:id/lineage` | Reads whole cascades, several hops deep |

The inference-history routes are now protected by the hosted identity check
below. Other surfaces remain unreviewed. This is a historical
exposure table, not a claim about a current public deployment.

`npm run dev` and `npm start` bind `127.0.0.1` for this reason. A container
deployment binds `0.0.0.0` inside the container and is exposed only on the
private network - the app's own posture does not change.

## Limited public preview

The preview is a local browser canvas with keyless public data and an optional
Kev persona suggestion. Kev receives only the question the visitor enters and
submits in the Personas tab. Its answer only suggests one of four existing
perspectives; the visitor chooses whether to use it. It does not answer the
question or send the canvas to the configured Kev endpoint.

Deploy the preview only after all of these are true:

- Set `OMNI_PUBLIC_DEMO=1` and `NEXT_PUBLIC_OMNI_PUBLIC_DEMO=1`. Verify
  `/api/llm`, `/api/jev-persona`, `/api/capability-broker` and
  `/api/registry-intent` return 503 on the deployed host. Do not set
  `TYPESAFE_API_KEY` on the public Worker. Both inference ledger routes must return no runs: on the
  Worker, production mode with no OIDC issuer answers 503 "Hosted
  authentication is not configured" before the preview check, and without
  hosted auth they answer `configured:false`. Either is acceptable. Do not set `DATABASE_URL`,
  or Anthropic/Google keys on the public Worker.
- If enabling Kev persona suggestions, keep `DECISION_PROVIDER=kev` and
  `NEXT_PUBLIC_DECISION_PROVIDER=kev`. After authorizing question transmission
  to the selected Kev host, set `OMNI_KEV_ENABLED=1` and
  `NEXT_PUBLIC_OMNI_KEV_ENABLED=1`. Set `KEV_BASE_URL` to the trusted HTTPS
  endpoint origin, `KEV_API_KEY` as a
  server secret, `KEV_MODEL=kev-latest`, and `KEV_REVISION` to the immutable
  40-character deployment/model commit SHA. The serving endpoint must attest
  that SHA in the `X-Kev-Revision` response header; mismatches fail closed.
  The old Jev feature flag alone cannot authorize transmission to Kev.
  Set both provider variables to `jev`, set `OMNI_JEV_ENABLED=1` and
  `NEXT_PUBLIC_OMNI_JEV_ENABLED=1`, and store `OPENROUTER_API_KEY` for
  explicit Jev rollback. Rate-limit `/api/jev-persona` at the edge
  before enabling the feature. The app's same-origin check and 500-character
  limit prevent accidental misuse, but do not stop automated direct requests.
- Validate the Next-to-Cloudflare runtime build and smoke-test the deployed
  routes before attaching `omni.syberlabs.io`. The existing local Next server
  is not a Cloudflare deployment.

### Deploying the preview

`wrangler.jsonc` sets the preview flags and attaches `omni.syberlabs.io` as a
Workers custom domain. The `syberlabs.io` zone must be in the same Cloudflare
account. Deploy from a clean checkout of `main`:

```bash
npm ci
npm run build               # the same vinext build CI scans and tests
npx wrangler login          # once per machine, or set CLOUDFLARE_API_TOKEN
npm run start:vinext        # optional: smoke-test the Worker on localhost
npm run deploy:vinext
```

`npm run build` is the one build path: CI runs it in every job, scans its
`dist/client` for secret canaries, dry-runs the Worker bundle with wrangler,
and on every push to `main` uploads `dist/` plus that bundle as the
`omnios-release-<sha>` workflow artifact. The build is not byte-reproducible
(each run mints a new build id and chunk hashes), so a deploy that wants to
ship exactly what CI tested must download that artifact rather than rebuild;
a rebuild at the same commit runs the same command on the same source and
nothing more. `next build` remains only as the server the Playwright golden
path drives (`npm run build:next`); nothing deploys it.

Then run the route checks above against `https://omni.syberlabs.io`.
`workers.dev` and preview URLs are off, so the custom domain is the only
address. To undo a bad release, `npx wrangler rollback` restores the prior
version.

### Automatic deploys (off until enabled)

`.github/workflows/deploy-preview.yml` runs the steps above after CI passes
on a push to `main`, or by hand from the Actions tab. It does nothing until an
admin sets all of these in the repository:

- variable `DEPLOY_PREVIEW` = `true`
- variable `CLOUDFLARE_ACCOUNT_ID`: the account that owns the `omni-os` Worker.
  `wrangler.jsonc` names none, and a person logged in to two accounts must
  choose; the first deploy went to the account of the person who ran it.
- secret `CLOUDFLARE_API_TOKEN`: a token that can edit Workers scripts and the
  `omni.syberlabs.io` route in that account. Create it for this use only.
- optionally, required reviewers on the `preview-deploy` environment, so each
  release waits for a person.

After the upload it checks the live host (page 200; `/api/llm`,
`/api/jev-persona`, `/api/capability-broker`, `/api/registry-intent` and
`/api/inference-runs` all 503) and runs `wrangler rollback` if any check fails.
This is the route-check list above, run by a machine. Status: implemented and
tested for its check script and YAML; not yet run on a runner, because no token
is configured.

This preview does not satisfy the controls for the full app. Keep the private
deployment requirements below for any deployment that enables paid LLMs
or the inference ledger.

## Before the full app is publicly accessible

## Hosted identity and durable inference

`NODE_ENV=production` requires hosted identity unless a trusted deployment
explicitly sets `OMNI_DEPLOYMENT_MODE=local`. `OMNI_DEPLOYMENT_MODE=hosted`
also enables it in development. Hosted API requests use an OIDC bearer token;
the server fetches discovery metadata from the configured issuer, requires an
exact issuer match, and verifies signing keys, audience, expiry, issue time,
and subject. `OMNI_AUTH_AUDIENCE` must identify this API/resource; it must not
be the browser client ID or an ID-token audience. Tokens older than five
minutes are rejected, with 30 seconds of clock tolerance. The issuer must stop
issuing access tokens when a user is revoked; a still-valid token can otherwise
remain accepted within that bounded age window. Owner identity is the verified
`iss:sub`, never a caller header. Configure `OMNI_AUTH_ISSUER` and
`OMNI_AUTH_AUDIENCE`; absent config fails closed. The browser has no sign-in/token
acquisition flow yet, so a real issuer and client integration remain deployment
prerequisites.

Hosted identity protects `POST /api/llm`, inference history, and lineage. It
does not make other routes production-ready. Local use needs no
account and keeps the canvas available offline. Local `npm run dev` and
`npm start` bind to `127.0.0.1`; container listeners must remain private unless
all other API surfaces are separately protected.

Per-caller rate budgets (today only `/api/capability-broker`, 30 requests a
minute per caller under a global 120) key on `clientKey()` in
`src/core/services/server/clientKey.ts`. It reads a client address from a
header only under the ingress `OMNI_TRUSTED_PROXY` declares:
`cloudflare` trusts `cf-connecting-ip` (the edge sets and overwrites it);
`proxy`, or the older `1`, trusts `x-real-ip`, else the last
`x-forwarded-for` hop. No header is trusted outside its declared ingress,
and with the variable unset every caller shares one `direct` bucket, so a
client-written header cannot buy a fresh budget; the global cap is the
backstop. Set `cloudflare` on the Worker (in `wrangler.jsonc` `vars`) once
the broker is enabled there, and `proxy` only behind your own reverse proxy
that overwrites, not appends to, the headers it forwards. A bare `next dev`,
`next start` or `wrangler dev` has no owning ingress; leave it unset.

Hosted inference also requires `DATABASE_URL` and migration 003. Each paid
request carries `Idempotency-Key`; the ledger stores owner, key, and digest
with the `running` attempt before provider dispatch. Reusing a key with the
same request returns the existing attempt and status without dispatch; a
different request returns 409. A caller retrying the same logical turn must
reuse its `idempotencyKey` option; an omitted client key creates a fresh value
for each call. The key is retained as long as its ledger row.
Historical rows stay ownerless and are not assigned to the first user who
signs in. Stale hosted rows older than three minutes become `uncertain`, which
means the provider outcome is unresolved and must not be blindly retried.
The request's 60-second total deadline starts at route entry and covers auth,
bounded body reading, ledger admission, and provider work. Hosted mode rejects
admission when durable ledger creation fails. Stale-row reconciliation runs on
hosted ledger reads/admission and marks abandoned `running` rows `uncertain`;
there is no independent cleanup worker. Local mode keeps the optional ledger
and no-database inference behavior.

## Remaining before any public URL

- [ ] Protect `/` and any other hosted surface; enforce abuse and
      paid-call limits by authenticated owner. These routes have not been
      verified as covered by the new identity boundary.
- [ ] Configure a real OIDC issuer/audience and add browser sign-in/token
      acquisition. No identity provider or hosted deployment was provisioned
      or verified as part of this code change.
- [ ] Before enabling paid browser inference, wire a per-logical-turn
      idempotency key into the active UI and retain it across retries. The
      current browser client does not persist/reuse that key; retries without
      it create a new attempt and may dispatch another provider request. The
      API contract supports caller-supplied stable keys, but active UI retries
      are not yet safe to rely on.
- [ ] Restrict Ollama egress in the deployed network. App code fixes the hosted
      destination from server config and rejects redirects, but cloud firewall/
      VPC egress enforcement has not been deployed or verified.
- [ ] Choose retention and deletion policy for inference rows, prompt/output
      excerpts, idempotency keys, and backups.

## What CI already guarantees

Every push and PR, four jobs (`.github/workflows/ci.yml`):

| Job | Guarantees |
|-----|-----------|
| **Typecheck, Test & Build** | tsc, vitest, eslint (0 errors), `next build`, Playwright golden path |
| **Client bundle carries no secrets** | Builds with a canary value for every secret env var, then fails if any reaches `.next/static` |
| **Inference Ledger (Postgres)** | Migrations apply and re-apply cleanly against `postgres:16`; owner-scoped lineage, idempotency constraints, foreign keys and recursive walks execute |
| **Dependency audit** | Production dependencies block on `high`; dev-only advisories are reported, not blocking |

The bundle scan is the one worth understanding, because it guards the property
the whole server-proxy architecture exists for. It does not grep for variable
*names* - a name proves nothing, and CI has no real keys. It builds with
`ANTHROPIC_API_KEY=OMNI-CANARY-ANTHROPIC_API_KEY-<run id>` and friends, then
looks for those exact values in what a browser is served. A canary in
`.next/static` means a real key would have been there too.

Run it locally against your own `.env`:

```bash
npm run build
npm run scan:bundle
```

It exits `2` rather than `0` if it could not have failed - no bundle, or no
secrets set. A scan that proves nothing does not get to report a pass.

## When CD is built

Whatever the target, these carry over:

- **Migrations run before the new version serves traffic**, as a release step
  that fails the deploy. `npm run db:migrate` is idempotent and records applied
  files in `schema_migrations`, so a re-run is a no-op.
- **`DATABASE_URL` is a deploy secret**, never baked into an image. It is in
  `SECRET_ENV_VARS`, so the bundle scan already covers it.
- **The image needs `output: 'standalone'`** in a Next config file at the
  repo root. There is none today, because nothing needs one yet.
- **Ollama reachability decides the target.** `provider: 'local'` is
  first-class in this app and needs to reach `localhost:11434`. A serverless
  deploy silently breaks it; a container on a host that can see Ollama does
  not. That is the main reason a Docker image beats Vercel here, despite
  Vercel being the obvious answer for a Next app.

## SyberLabs private account backups

The upper-right account control uses the host-only session at syberlabs.io via
credentialed requests to `/admin/api/v1/account` and `/admin/api/v1/saves`.
The versioned contract is `SyberLabs/MasterMind`
`docs/contracts/account-saves-v1.md`. Deploy that producer before this consumer.
Signing in returns through the sealed `/admin/return?app=omni` path; it does not
enable paid inference or change the public-preview restrictions.

All backup list, detail and create requests send `X-SyberLabs-Expected-User`
with the account shown when the operation began. The producer rejects a cookie
that changed to another account before accessing backup rows. A failed save
retains its original account, payload and retry UUID; a different displayed
account cannot take over that retry. Account changes invalidate old panel
responses before a restore can write browser storage.

Browser IndexedDB remains the live canvas. Save to account explicitly uploads a
private backup including notes and conversation content. Only current store keys
are included, legacy provider keys are stripped, and imported write/destructive
capability approvals are reset. Restore requires confirmation, downloads the
current canvas first, validates the backup, and uses the existing vault import
path. Local downloads remain available if central storage is unavailable.
