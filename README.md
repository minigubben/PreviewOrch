# PR Preview Orchestrator

Small Docker-based PR preview orchestration for GitHub repositories that ship a repo-owned Docker Compose file.

## What It Does

- Receives GitHub `pull_request` webhooks.
- Clones the PR head into `data/deployments/{repoSlug}/pr-{number}`.
- Writes runtime env vars into `.env.runtime`.
- Runs `docker compose up -d --build` for the PR.
- Destroys the preview with `docker compose down -v --remove-orphans` when the PR closes.
- Exposes an admin UI behind Traefik at `orchestrator.{BASE_DOMAIN}`.

## Stack

- `traefik`: reverse proxy for the admin app and preview containers
- `cloudflared`: optional public ingress through a Cloudflare Tunnel
- `app`: Node.js admin app, webhook intake, and shell-script orchestrator

## Local Layout

- `docker-compose.yml`: base orchestrator stack
- `scripts/`: validation, deploy, and destroy shell scripts
- `src/`: Express app, file stores, webhook handling, and UI
- `data/config/repos.json`: repo definitions
- `data/deployments/`: per-PR clones and metadata
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
```

`SESSION_COOKIE_SECURE=auto` is the recommended default. It marks the cookie `Secure` when the request is actually HTTPS, but still allows local or plain-HTTP access during initial setup. Set it to `true` only if every admin request reaches the app as HTTPS through your proxy chain.

Generate the bcrypt hash with:

```bash
node -e 'console.log(require("bcryptjs").hashSync("change-me", 10))'
```

## SSH Access

Mount one SSH private key into `data/ssh/` so the app container can clone configured repos:

- `data/ssh/id_ed25519`, or
- `data/ssh/id_rsa`

The scripts automatically set `GIT_SSH_COMMAND` to use that key.

## Run

Install dependencies for local development:

```bash
npm install
```

Start the app directly:

```bash
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

The admin UI is then routed by Traefik at `orchestrator.{BASE_DOMAIN}`, and PR previews are routed at `{repoSlug}-pr-{number}.{BASE_DOMAIN}`.

## Admin Workflow

1. Sign in at `orchestrator.{BASE_DOMAIN}`.
2. Add a repository with:
   - owner
   - repo name
   - clone SSH URL
   - default branch
   - compose file path
   - public service name
   - public port
3. The app validates:
   - `git ls-remote`
   - shallow clone of the default branch
   - compose path existence
   - public service existence
   - required Traefik label contract
4. Configure a GitHub webhook to `POST /webhooks/github`.

## GitHub Webhook Setup

- Event type: `pull_request`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET`

Handled actions:

- `opened`
- `reopened`
- `synchronize`
- `closed`

## Compose Contract

The repo-owned compose file must keep the Traefik labels on the configured public service.

See [docs/compose-contract.md](/home/agent/utveckling_git/pr-orchestrator/docs/compose-contract.md).

## Tests

```bash
npm test
```

## Notes

- The app stores config and deployment metadata on disk, not in a database.
- Deployment actions are serialized per `{repoId, prNumber}` inside the Node process.
- On PR close, the preview stack is destroyed and the working directory is deleted.
