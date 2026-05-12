<p align="center">
  <img src="src/public/brand/previeworch.png" alt="PreviewOrch logo" width="120" />
</p>

# PreviewOrch

Docker-based preview orchestration for GitHub repositories that ship a repo-owned Docker Compose file.

## What It Does

- Receives GitHub `pull_request` webhooks and validates their signatures.
- Lets an operator manage repositories and trigger manual branch or PR deploys from the admin UI.
- Clones the target revision into `data/deployments/{repoSlug}/{deploymentKey}`.
- Writes `.env.runtime`, optionally appends a Traefik override, and runs `docker compose up -d --build`.
- Destroys preview stacks with `docker compose down -v --remove-orphans` when PRs close or an operator destroys them.
- Stores repo config, deployment metadata, SSH keys, and logs on disk.

## How It Works

1. `src/server.ts` loads environment config and starts the Express app.
2. `src/app.ts` wires sessions, auth, webhook intake, API routes, UI routes, and static assets.
3. Repository definitions live in `data/config/repos.json` and are validated through `scripts/validate-repo.sh` before they are saved.
4. Webhooks and manual deploy actions flow through `DeploymentService`, which serializes work per deployment and shells out to `scripts/deploy-pr.sh` or `scripts/destroy-pr.sh`.
5. The dashboard polls for repo/deployment updates and shows logs, runtime inspection data, and SSH key status.

## Stack

- `app`: Node.js, Express, EJS, a small Vite/Tailwind client, and shell-script orchestration
- `traefik`: reverse proxy for the admin UI and preview stacks
- `cloudflared`: optional Cloudflare Tunnel sidecar
- `docker compose`: runtime for both the orchestrator stack and preview stacks

## Docs

- [How the app works](docs/how-it-works.md)
- [Architecture flowchart](docs/architecture.md)
- [Compose contract](docs/compose-contract.md)
- [GHCR deployment compose](docs/docker-compose.ghcr.yml)

## Local Layout

- `src/`: Express app, services, routes, views, client code, and static brand assets
- `scripts/`: validation, deploy, and destroy scripts
- `data/config/`: repo and settings JSON
- `data/deployments/`: working copies and deployment metadata
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

Generate the bcrypt hash with:

```bash
node -e 'console.log(require("bcryptjs").hashSync("change-me", 10))'
```

`SESSION_COOKIE_SECURE=auto` is the recommended default. `GITHUB_DEPLOYMENTS_TOKEN` is optional and only enables GitHub Deployments publishing. `ORCHESTRATOR_PUBLIC_URL` is optional and overrides the URL used in deployment status links.

## Run

```bash
npm install
npm run build
npm start
```

Or start the full stack:

```bash
docker compose up --build
```

## Webhook Setup

- Payload URL: `https://previeworch.{BASE_DOMAIN}/webhooks/github`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET`
- Events: `Pull requests`

Handled PR actions:

- `opened`
- `reopened`
- `synchronize`
- `closed`

## Tests

```bash
npm run typecheck
npm test
```
