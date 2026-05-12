# PreviewOrch

Small Docker-based preview orchestration for GitHub repositories that ship a repo-owned Docker Compose file.

## What It Does

- Receives GitHub `pull_request` webhooks.
- Accepts GitHub webhook `ping` requests so endpoint validation works when the webhook is created or edited.
- Clones the PR head into `data/deployments/{repoSlug}/pr-{number}`.
- Writes runtime env vars into `.env.runtime`.
- Runs `docker compose up -d --build` for the PR.
- Destroys the preview with `docker compose down -v --remove-orphans` when the PR closes.
- Supports manual deployments of either a branch or a PR from the admin UI.
- Exposes an admin UI behind Traefik at `previeworch.{BASE_DOMAIN}`.

## Stack

- `traefik`: reverse proxy for the admin app and preview containers
- `cloudflared`: optional public ingress through a Cloudflare Tunnel
- `app`: Node.js admin app, webhook intake, and shell-script orchestrator

## Local Layout

- `docker-compose.yml`: base orchestrator stack
- `scripts/`: validation, deploy, and destroy shell scripts
- `src/`: Express app, file stores, webhook handling, and UI
- `data/config/repos.json`: repo definitions
- `data/deployments/`: per-deployment clones and metadata
- `data/logs/`: app log, event log, and per-deployment logs

## Required Environment

Copy `.env.example` to `.env` and set:

```bash
BASE_DOMAIN=preview.example.com
CLOUDFLARED_TUNNEL_TOKEN=...
ADMIN_USERNAME=admin
ADMIN_PASSWORD_BCRYPT_HASH=...
SESSION_SECRET=...
SESSION_COOKIE_SECURE=auto
GITHUB_WEBHOOK_SECRET=...
GITHUB_DEPLOYMENTS_TOKEN=
ORCHESTRATOR_PUBLIC_URL=
```

`SESSION_COOKIE_SECURE=auto` is the recommended default. It marks the cookie `Secure` when the request is actually HTTPS, but still allows local or plain-HTTP access during initial setup. Set it to `true` only if every admin request reaches the app as HTTPS through your proxy chain.

The app image includes Docker Compose and the `buildx` plugin, so Compose Bake-capable builds work inside the orchestrator container without extra host setup.

Generate the bcrypt hash with:

```bash
node -e 'console.log(require("bcryptjs").hashSync("change-me", 10))'
```

`GITHUB_DEPLOYMENTS_TOKEN` is optional. If it is set, the orchestrator will publish GitHub deployment entries and deployment statuses for previews so they appear on pull requests and in the repository deployment views. If it is unset, the orchestrator still runs normally and simply skips GitHub deployment publishing.

Recommended token type:

- Fine-grained personal access token
- Repository access limited to the repos managed by the orchestrator
- Repository permission: `Deployments` = `Read and write`

By default, GitHub deployment statuses link back to `https://previeworch.{BASE_DOMAIN}`. `ORCHESTRATOR_PUBLIC_URL` is optional and only needed if PreviewOrch is exposed at some different external URL.

## SSH Access

Generate the SSH keypair from the admin UI. The dashboard shows the current public key so it can be copied into GitHub deploy keys or your automation account.

- The app stores the active keypair in `data/ssh/`
- Generated keys use `id_ed25519` and `id_ed25519.pub`
- You can rotate the keypair from the same dashboard action

The scripts automatically set `GIT_SSH_COMMAND` to use `data/ssh/id_ed25519` when it exists, otherwise they fall back to `data/ssh/id_rsa`.

## Run

Install dependencies for local development:

```bash
npm install
```

Start the app directly:

```bash
npm run build
npm start
```

Or start the full stack:

```bash
docker compose up --build
```

## Cloudflare Tunnel Target

Configure Cloudflare Tunnel ingress to forward your wildcard hostname to the Traefik `web` entrypoint on port `80`.

- If Cloudflare reaches the Docker network directly, point it to `http://traefik:80`
- If Cloudflare is configured outside Docker on the same host, point it to `http://<host-ip>:80`

The admin UI is then routed by Traefik at `previeworch.{BASE_DOMAIN}`, and previews are routed at `{repoSlug}-{deploymentKey}.{BASE_DOMAIN}`.

## Admin Workflow

1. Sign in at `previeworch.{BASE_DOMAIN}`.
2. Add a repository with:
   - clone SSH URL
   - default branch
   - working directory inside the repo, default `.`
   - compose file path
   - public service name
   - public port
   - optional checkbox to append proxy settings to the selected service
   - optional preview host alias env var name, for example `APP_FQDN`
   - optional extra env vars as `KEY=value` lines
3. The app validates:
   - `git ls-remote`
   - shallow clone of the default branch
   - working directory existence
   - compose path existence
   - public service existence
   - required Traefik label contract, unless proxy settings will be appended by the orchestrator
4. Use the repo editor to deploy a branch name or PR number manually when you need an on-demand environment outside the normal webhook flow.
5. Configure a GitHub webhook to `POST /webhooks/github`.

## GitHub Webhook Setup

- Payload URL: `https://previeworch.{BASE_DOMAIN}/webhooks/github`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET`
  - In the orchestrator `.env` file, do not wrap `GITHUB_WEBHOOK_SECRET` in quotes
- Enable SSL verification: `true`
- Events:
  - If using “Let me select individual events”, select `Pull requests`
  - GitHub will still send a `ping` event when the webhook is created or updated, and the orchestrator now responds successfully to that request

Handled actions:

- `opened`
- `reopened`
- `synchronize`
- `closed`

Webhook behavior:

- `ping`: returns `200 OK` and confirms the endpoint is reachable
- unsupported GitHub events: return `200 OK` with `{ "ignored": true }`

## Optional GitHub Deployment Publishing

If `GITHUB_DEPLOYMENTS_TOKEN` is configured, the orchestrator publishes preview deployments back to GitHub using the Deployments API.

- PR previews create a deployment against `refs/pull/<number>/head`
- Branch previews create a deployment against the branch name or resolved SHA
- States are published as:
  - `pending` when the preview starts
  - `success` when the preview is ready
  - `failure` if the preview deploy fails
  - `inactive` when the preview is destroyed
- The preview URL is published as the deployment `environment_url`
- The deployment `log_url` points back to the PreviewOrch UI at `https://previeworch.{BASE_DOMAIN}` by default, or `ORCHESTRATOR_PUBLIC_URL` if you override it

This integration is best-effort by design. GitHub deployment publishing failures are logged, but they do not block preview creation or teardown.

## Compose Contract

The repo-owned compose file can keep the Traefik labels on the configured public service, or the orchestrator can append them automatically when `Append proxy settings to this service` is enabled in the admin UI.

See [docs/compose-contract.md](/home/agent/utveckling_git/pr-orchestrator/docs/compose-contract.md).

## Runtime Env Behavior

Each deployment always writes the generated preview host to:

- `ORCH_PREVIEW_HOST`

If you configure a preview host alias env var in the admin UI, for example `APP_FQDN`, the same generated host is also written to:

- `APP_FQDN`

This keeps `ORCH_PREVIEW_HOST` as the stable orchestrator variable while still letting the app read the env var name it expects.

## Tests

```bash
npm run typecheck
npm test
```

## Notes

- The app stores config and deployment metadata on disk, not in a database.
- Deployment actions are serialized per `{repoId, deploymentKey}` inside the Node process.
- On PR close, the preview stack is destroyed and the working directory is deleted.
