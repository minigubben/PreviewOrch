# PreviewOrch Architecture

This diagram shows the end-to-end control flow from operator input or GitHub webhook to Docker Compose preview lifecycle and dashboard feedback.

```mermaid
flowchart TD
    A[Operator Browser] -->|GET /login| B[Auth Routes]
    AI[Health Checks] -->|GET /healthz| AJ[Health Route]
    B -->|session cookie| C[Dashboard UI]
    C -->|JSON form/actions| D[API Routes]
    A -->|POST /webhooks/github| E[GitHub Webhook Route]
    F[GitHub] -->|pull_request or ping| E

    D --> G[RepoStore]
    G --> H[data/config/repos.json]
    G --> I[scripts/validate-repo.sh]
    I --> J[script-helper CLI]

    D --> K[DeploymentService]
    E --> K

    K --> L[LockManager]
    K --> M[DeploymentStore]
    M --> N[data/deployments/*/deployment.json]
    K --> O[Logger]
    O --> P[data/logs/app.log + events.jsonl]
    K --> Q[GithubDeploymentPublisher]
    Q -->|optional Deployments API| F
    K --> R[ScriptRunner]

    R -->|deploy| S[scripts/deploy-pr.sh]
    R -->|destroy| T[scripts/destroy-pr.sh]

    S --> U[data/ssh/id_ed25519 or id_rsa]
    S --> V[git clone target ref]
    S --> W[write .env.runtime]
    S --> X[optional proxy override]
    S --> Y[docker compose up -d --build]
    S --> N

    T --> N
    T --> Z[docker compose down -v --remove-orphans]
    T --> AA[remove work directory]

    C -->|poll /ui/repo-config + /ui/deployments| AB[UI Routes]
    AJ --> AK[repos.json + settings.json readable]
    AJ --> AL[docker version reachable]
    AB --> G
    AB --> K
    AB --> AC[RuntimeInspector]
    AC --> AD[Docker inspect + logs]
    AB --> AE[SshKeyManager]
    AE --> U
    AB --> P

    Y --> AF[Preview Containers]
    AF --> AG[Traefik]
    AG -->|previeworch.BASE_DOMAIN| C
    AG -->|repoSlug-deploymentKey.BASE_DOMAIN| AH[Preview URL]
```

## Key Files

- `src/server.ts`: process entrypoint
- `src/app.ts`: Express wiring
- `src/routes/auth.ts`: login/logout
- `src/routes/ui.ts`: dashboard and HTML fragment refreshes
- `src/routes/api.ts`: repo, deployment, and SSH actions
- `src/routes/github-webhooks.ts`: webhook verification and routing
- `src/lib/repo-store.ts`: repository persistence and validation
- `src/lib/deployment-service.ts`: deploy/destroy orchestration
- `src/lib/deployment-store.ts`: deployment metadata persistence
- `src/lib/runtime-inspector.ts`: Docker runtime inspection for the UI
- `src/lib/github-deployment-publisher.ts`: optional GitHub Deployments updates
- `scripts/validate-repo.sh`: pre-save repo validation
- `scripts/deploy-pr.sh`: preview creation
- `scripts/destroy-pr.sh`: preview teardown
