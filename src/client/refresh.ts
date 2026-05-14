import { bindDashboard } from "./dashboard";
import { fetchHtml } from "./http";
import { initPanelSelector } from "./panels";

const DEPLOYMENTS_REFRESH_MS = 5000;

let deploymentsRefreshTimer: number | null = null;
let deploymentsRefreshInFlight = false;

export async function refreshRepoConfig({
  preferredPanelId,
}: { preferredPanelId?: string } = {}): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-repo-config-root]");
  if (!root) {
    return;
  }

  const html = await fetchHtml("/ui/repo-config");
  root.outerHTML = html;

  if (preferredPanelId) {
    window.location.hash = preferredPanelId;
  }

  bindDashboard(document);
  initPanelSelector();
}

export async function refreshDeployments(): Promise<void> {
  if (deploymentsRefreshInFlight) {
    return;
  }

  const root = document.querySelector<HTMLElement>("[data-deployments-root]");
  if (!root) {
    return;
  }

  deploymentsRefreshInFlight = true;
  const openState = captureOpenState(root);

  try {
    const html = await fetchHtml("/ui/deployments");
    root.outerHTML = html;
    const newRoot = document.querySelector<HTMLElement>("[data-deployments-root]");
    restoreOpenState(newRoot, openState);
    bindDashboard(document);
  } catch (error) {
    const statusNode = document.querySelector<HTMLElement>("[data-ui-status]");
    if (statusNode && !statusNode.textContent) {
      statusNode.textContent = error instanceof Error ? error.message : "Unable to refresh UI.";
    }
  } finally {
    deploymentsRefreshInFlight = false;
  }
}

export function startDeploymentsPolling(): void {
  if (deploymentsRefreshTimer || typeof window === "undefined") {
    return;
  }

  deploymentsRefreshTimer = window.setInterval(() => {
    void refreshDeployments();
  }, DEPLOYMENTS_REFRESH_MS);
}

function captureOpenState(root: ParentNode | null): Set<string> {
  const keys = new Set<string>();
  if (!root) {
    return keys;
  }

  root.querySelectorAll<HTMLDetailsElement>("details[data-preserve-open]").forEach((node) => {
    if (node.open && node.dataset.preserveOpen) {
      keys.add(node.dataset.preserveOpen);
    }
  });

  return keys;
}

function restoreOpenState(root: ParentNode | null, keys: Set<string>): void {
  if (!root || !keys.size) {
    return;
  }

  root.querySelectorAll<HTMLDetailsElement>("details[data-preserve-open]").forEach((node) => {
    node.open = Boolean(node.dataset.preserveOpen && keys.has(node.dataset.preserveOpen));
  });
}
