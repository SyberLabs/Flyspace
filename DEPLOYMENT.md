# Deployment

There is one deployment: the limited public preview at https://omni.syberlabs.io,
a Cloudflare Worker deployed by hand since 2026-10-03. `wrangler.jsonc` sets its
two demo flags and attaches the custom domain; it has no secret and no database.

Everything the preview could not reach was deleted on 2026-11-02 (`APEX_PLAN.md`
§7), including the code that spent provider keys. Do not set a provider key or a
database URL on the Worker: nothing reads them.

## What the preview serves

A local browser canvas with keyless public data. Canvas state stays in the
browser's IndexedDB unless the visitor saves an account backup (below).

| Route | Answer |
|-------|--------|
| `GET /`, static assets | the canvas |
| `GET /api/public`, `POST /api/public` | keyless proxy to a fixed list of public providers |
| `GET /api/polymarket` | Polymarket markets |
| `POST /api/llm`, `POST /api/jev-persona`, `POST /api/capability-broker`, `POST /api/registry-intent`, `GET /api/inference-runs` | always 503 |

The 503 routes are one-line stubs that no client calls. They stay only because
`.github/workflows/deploy-preview.yml` asserts those answers after every deploy
and rolls back otherwise. Remove a stub only together with its check in that
workflow.

## Deploying the preview

The `syberlabs.io` zone must be in the same Cloudflare account. Deploy from a
clean checkout of `main`:

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

Then check the routes above against `https://omni.syberlabs.io`.
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

After the upload it runs the route checks and `wrangler rollback` if any fails.
Status: implemented and tested for its check script and YAML; not yet run on a
runner, because no token is configured.

## What CI already guarantees

Every push and PR, three jobs (`.github/workflows/ci.yml`):

| Job | Guarantees |
|-----|-----------|
| **Typecheck, Test & Build** | tsc, vitest, eslint (0 errors), the Worker build and dry run, Playwright golden path |
| **Client bundle carries no secrets** | Builds with a canary value for every name in `SECRET_ENV_VARS`, then fails if any reaches `dist/client` |
| **Dependency audit** | Production dependencies block on `high`; dev-only advisories are reported, not blocking |

The bundle scan does not grep for variable *names* - a name proves nothing, and
CI has no real keys. It builds with `ALPHA_VANTAGE_API_KEY=OMNI-CANARY-ALPHA_VANTAGE_API_KEY-<run id>`
and friends, then looks for those exact values in what a browser is served.

Run it locally against your own `.env`:

```bash
npm run build
npm run scan:bundle
```

It exits `2` rather than `0` if it could not have failed - no bundle, or no
secrets set. A scan that proves nothing does not get to report a pass.

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
