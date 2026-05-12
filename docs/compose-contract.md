# Compose Contract

Each configured repository must provide a compose file that already contains the Traefik routing labels on the service you mark as public in the admin UI.

## Required Runtime Variables
The orchestrator writes these into `.env.runtime` for each PR deployment:

- `ORCH_PROJECT_NAME`
- `ORCH_PREVIEW_HOST`
- `ORCH_PREVIEW_SERVICE_PORT`
- `ORCH_PR_NUMBER`
- `ORCH_PR_BRANCH`
- `ORCH_PR_SHA`
- `ORCH_REPO_SLUG`

The admin UI can also append:

- one optional preview-host alias variable, for example `APP_FQDN`, with the same value as `ORCH_PREVIEW_HOST`
- any additional `KEY=value` env pairs configured on the repository

## Required Service Labels
The configured public service must include label values that reference:

- `traefik.enable=true`
- `${ORCH_PROJECT_NAME}`
- `${ORCH_PREVIEW_HOST}`
- `${ORCH_PREVIEW_SERVICE_PORT}`

## Example

```yaml
services:
  app:
    image: ghcr.io/example/app:latest
    networks:
      - default
      - preview-proxy
    labels:
      - traefik.enable=true
      - traefik.docker.network=preview-proxy
      - traefik.http.routers.${ORCH_PROJECT_NAME}.rule=Host(`${ORCH_PREVIEW_HOST}`)
      - traefik.http.routers.${ORCH_PROJECT_NAME}.entrypoints=web
      - traefik.http.services.${ORCH_PROJECT_NAME}.loadbalancer.server.port=${ORCH_PREVIEW_SERVICE_PORT}

networks:
  preview-proxy:
    external: true
    name: preview-proxy
```

## Validation Rules
On repo create or update, the orchestrator rejects the config if:

- the compose file does not exist at the configured path
- the configured public service does not exist
- the public service is missing the Traefik contract tokens
- the repo cannot be reached over SSH
