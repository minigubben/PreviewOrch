export function isRepoMutation(action: string): boolean {
  return /^\/api\/repos(?:\/[^/]+)?$/.test(action);
}

export function isRepoDelete(action: string): boolean {
  return /^\/api\/repos\/[^/]+$/.test(action);
}

export function isManualDeploy(action: string): boolean {
  return /^\/api\/repos\/[^/]+\/manual-deploy$/.test(action);
}

export function isDeploymentAction(action: string): boolean {
  return /^\/api\/deployments\/[^/]+(?:\/redeploy)?$/.test(action);
}

export function normalizePath(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}
