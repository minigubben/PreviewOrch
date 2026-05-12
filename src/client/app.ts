import "./styles.css";

declare global {
  interface Window {
    __panelHashListenerBound?: boolean;
    CSRF_TOKEN: string;
  }
}

const DEPLOYMENTS_REFRESH_MS = 5000;

let deploymentsRefreshTimer: number | null = null;
let deploymentsRefreshInFlight = false;

bindDashboard(document);
initPanelSelector();
startDeploymentsPolling();

async function submitForm(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const method = (form.dataset.method || form.method || "POST").toUpperCase();
  const action = form.action;
  const actionPath = normalizePath(action);
  const statusNode = document.querySelector<HTMLElement>("[data-ui-status]");
  const body = serializeForm(form);

  try {
    const response = await fetch(action, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": window.CSRF_TOKEN,
      },
      body: method === "DELETE" ? null : JSON.stringify(body),
    });

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(payload?.error || "Request failed.");
    }

    if (isRepoMutation(actionPath)) {
      const preferredPanelId = payload?.id ? `repo-${payload.id}` : getCurrentPanelId();
      if (statusNode) {
        statusNode.textContent = "Saved.";
      }
      await refreshRepoConfig({ preferredPanelId });
      return;
    }

    if (isManualDeploy(actionPath)) {
      if (statusNode) {
        statusNode.textContent = "Deployment started.";
      }
      await refreshDeployments();
      return;
    }

    if (statusNode) {
      statusNode.textContent = "Saved.";
    }
  } catch (error) {
    if (statusNode) {
      statusNode.textContent = error instanceof Error ? error.message : "Request failed.";
    }
  }
}

async function runAction(event: MouseEvent): Promise<void> {
  event.preventDefault();
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const statusNode = document.querySelector<HTMLElement>("[data-ui-status]");
  const confirmMessage = button.dataset.confirm;
  const actionPath = normalizePath(button.dataset.action || "");

  if (confirmMessage && !window.confirm(confirmMessage)) {
    return;
  }

  try {
    const response = await fetch(button.dataset.action || "", {
      method: button.dataset.method || "POST",
      headers: {
        "X-CSRF-Token": window.CSRF_TOKEN,
      },
    });

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(payload?.error || "Action failed.");
    }

    if (isRepoDelete(actionPath)) {
      if (statusNode) {
        statusNode.textContent = "Repository deleted.";
      }
      await refreshRepoConfig({ preferredPanelId: "add-repo" });
      return;
    }

    if (isDeploymentAction(actionPath)) {
      if (statusNode) {
        statusNode.textContent = button.dataset.method === "DELETE" ? "Deployment destroyed." : "Redeploy started.";
      }
      await refreshDeployments();
      return;
    }

    if (actionPath === "/api/ssh-keypair") {
      if (statusNode) {
        statusNode.textContent = "SSH key updated. Reloading...";
      }
      window.location.reload();
      return;
    }

    if (statusNode) {
      statusNode.textContent = "Action completed.";
    }
  } catch (error) {
    if (statusNode) {
      statusNode.textContent = error instanceof Error ? error.message : "Action failed.";
    }
  }
}

function bindDashboard(root: ParentNode = document): void {
  bindApiForms(root);
  bindApiActions(root);
}

function bindApiForms(root: ParentNode): void {
  root.querySelectorAll<HTMLFormElement>("[data-api-form]").forEach((form) => {
    if (form.dataset.bound === "true") {
      return;
    }
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      void submitForm(event);
    });
  });
}

function bindApiActions(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-api-action]").forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }
    button.dataset.bound = "true";
    button.addEventListener("click", (event) => {
      void runAction(event);
    });
  });
}

function serializeForm(form: HTMLFormElement): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      continue;
    }
    if (!element.name || element.disabled) {
      continue;
    }

    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      body[element.name] = element.checked;
      continue;
    }

    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (element.checked) {
        body[element.name] = element.value;
      }
      continue;
    }

    body[element.name] = element.value;
  }
  return body;
}

function initPanelSelector(): void {
  const triggers = Array.from(document.querySelectorAll<HTMLElement>("[data-panel-trigger]"));
  const panels = Array.from(document.querySelectorAll<HTMLElement>("[data-panel-id]"));

  if (!triggers.length || !panels.length) {
    return;
  }

  const byId = new Map(panels.map((panel) => [panel.dataset.panelId, panel]));

  function activate(id: string): void {
    triggers.forEach((trigger) => {
      const active = trigger.dataset.panelTarget === id;
      trigger.dataset.active = String(active);
      trigger.setAttribute("aria-selected", String(active));
      trigger.classList.toggle("bg-zinc-100", active);
      trigger.classList.toggle("text-black", active);
      trigger.classList.toggle("border-zinc-100", active);
      trigger.classList.toggle("bg-zinc-900", !active);
      trigger.classList.toggle("text-zinc-200", !active);
      trigger.classList.toggle("border-zinc-800", !active);
    });

    panels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panelId !== id);
    });
  }

  triggers.forEach((trigger) => {
    if (trigger.dataset.panelBound === "true") {
      return;
    }

    trigger.dataset.panelBound = "true";
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      const target = trigger.dataset.panelTarget;
      if (target) {
        window.location.hash = target;
        activate(target);
      }
    });
  });

  if (!window.__panelHashListenerBound) {
    window.__panelHashListenerBound = true;
    window.addEventListener("hashchange", () => {
      const target = window.location.hash.slice(1);
      const currentPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-panel-id]"));
      if (currentPanels.some((panel) => panel.dataset.panelId === target)) {
        initPanelSelector();
      }
    });
  }

  const initial = window.location.hash ? window.location.hash.slice(1) : triggers[0]?.dataset.panelTarget;
  const fallback = triggers[0]?.dataset.panelTarget || "add-repo";
  activate(initial && byId.has(initial) ? initial : fallback);
}

async function refreshRepoConfig({ preferredPanelId }: { preferredPanelId?: string } = {}): Promise<void> {
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

async function refreshDeployments(): Promise<void> {
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

function startDeploymentsPolling(): void {
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

function getCurrentPanelId(): string {
  if (!window.location.hash) {
    return "add-repo";
  }

  return window.location.hash.slice(1) || "add-repo";
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "X-Requested-With": "fetch",
    },
  });

  if (!response.ok) {
    throw new Error("Unable to refresh UI.");
  }

  return response.text();
}

async function readResponsePayload(response: Response): Promise<{ error?: string; id?: string } | null> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<{ error?: string; id?: string }>;
  }
  return null;
}

function isRepoMutation(action: string): boolean {
  return /^\/api\/repos(?:\/[^/]+)?$/.test(action);
}

function isRepoDelete(action: string): boolean {
  return /^\/api\/repos\/[^/]+$/.test(action);
}

function isManualDeploy(action: string): boolean {
  return /^\/api\/repos\/[^/]+\/manual-deploy$/.test(action);
}

function isDeploymentAction(action: string): boolean {
  return /^\/api\/deployments\/[^/]+(?:\/redeploy)?$/.test(action);
}

function normalizePath(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}
