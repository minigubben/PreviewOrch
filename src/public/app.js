const DEPLOYMENTS_REFRESH_MS = 5000;

let deploymentsRefreshTimer = null;
let deploymentsRefreshInFlight = false;

bindDashboard(document);
initPanelSelector();
startDeploymentsPolling();

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const method = (form.dataset.method || form.method || "POST").toUpperCase();
  const action = form.action;
  const actionPath = normalizePath(action);
  const statusNode = document.querySelector("[data-ui-status]");
  const body = serializeForm(form);

  try {
    const response = await fetch(action, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": window.CSRF_TOKEN,
      },
      body: method === "DELETE" ? undefined : JSON.stringify(body),
    });

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(payload?.error || "Request failed.");
    }

    if (isRepoMutation(actionPath)) {
      const preferredPanelId = payload?.id ? `repo-${payload.id}` : getCurrentPanelId();
      statusNode.textContent = "Saved.";
      await refreshRepoConfig({ preferredPanelId });
      return;
    }

    if (isManualDeploy(actionPath)) {
      statusNode.textContent = "Deployment started.";
      await refreshDeployments();
      return;
    }

    statusNode.textContent = "Saved.";
  } catch (error) {
    statusNode.textContent = error.message;
  }
}

async function runAction(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const statusNode = document.querySelector("[data-ui-status]");
  const confirmMessage = button.dataset.confirm;
  const actionPath = normalizePath(button.dataset.action);

  if (confirmMessage && !window.confirm(confirmMessage)) {
    return;
  }

  try {
    const response = await fetch(button.dataset.action, {
      method: button.dataset.method,
      headers: {
        "X-CSRF-Token": window.CSRF_TOKEN,
      },
    });

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(payload?.error || "Action failed.");
    }

    if (isRepoDelete(actionPath)) {
      statusNode.textContent = "Repository deleted.";
      await refreshRepoConfig({ preferredPanelId: "add-repo" });
      return;
    }

    if (isDeploymentAction(actionPath)) {
      statusNode.textContent = button.dataset.method === "DELETE" ? "Deployment destroyed." : "Redeploy started.";
      await refreshDeployments();
      return;
    }

    if (actionPath === "/api/ssh-keypair") {
      statusNode.textContent = "SSH key updated. Reloading...";
      window.location.reload();
      return;
    }

    statusNode.textContent = "Action completed.";
  } catch (error) {
    statusNode.textContent = error.message;
  }
}

function bindDashboard(root = document) {
  bindApiForms(root);
  bindApiActions(root);
}

function bindApiForms(root) {
  root.querySelectorAll("[data-api-form]").forEach((form) => {
    if (form.dataset.bound === "true") {
      return;
    }
    form.dataset.bound = "true";
    form.addEventListener("submit", submitForm);
  });
}

function bindApiActions(root) {
  root.querySelectorAll("[data-api-action]").forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }
    button.dataset.bound = "true";
    button.addEventListener("click", runAction);
  });
}

function serializeForm(form) {
  const body = {};
  for (const field of form.elements) {
    if (!field.name || field.disabled) {
      continue;
    }

    if (field.type === "checkbox") {
      body[field.name] = field.checked;
      continue;
    }

    if (field.type === "radio") {
      if (field.checked) {
        body[field.name] = field.value;
      }
      continue;
    }

    body[field.name] = field.value;
  }
  return body;
}

function initPanelSelector() {
  const triggers = Array.from(document.querySelectorAll("[data-panel-trigger]"));
  const panels = Array.from(document.querySelectorAll("[data-panel-id]"));

  if (!triggers.length || !panels.length) {
    return;
  }

  const byId = new Map(panels.map((panel) => [panel.dataset.panelId, panel]));

  function activate(id) {
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
      if (typeof window !== "undefined") {
        window.location.hash = target;
      }
      activate(target);
    });
  });

  if (typeof window !== "undefined" && !window.__panelHashListenerBound) {
    window.__panelHashListenerBound = true;
    window.addEventListener("hashchange", () => {
      const target = window.location.hash.slice(1);
      const currentPanels = Array.from(document.querySelectorAll("[data-panel-id]"));
      if (currentPanels.some((panel) => panel.dataset.panelId === target)) {
        initPanelSelector();
      }
    });
  }

  const initial = typeof window !== "undefined" && window.location.hash ? window.location.hash.slice(1) : triggers[0].dataset.panelTarget;
  const fallback = triggers[0].dataset.panelTarget;
  activate(byId.has(initial) ? initial : fallback);
}

async function refreshRepoConfig({ preferredPanelId } = {}) {
  const root = document.querySelector("[data-repo-config-root]");
  if (!root) {
    return;
  }

  const html = await fetchHtml("/ui/repo-config");
  root.outerHTML = html;

  if (preferredPanelId && typeof window !== "undefined") {
    window.location.hash = preferredPanelId;
  }

  bindDashboard(document);
  initPanelSelector();
}

async function refreshDeployments() {
  if (deploymentsRefreshInFlight) {
    return;
  }

  const root = document.querySelector("[data-deployments-root]");
  if (!root) {
    return;
  }

  deploymentsRefreshInFlight = true;
  const openState = captureOpenState(root);

  try {
    const html = await fetchHtml("/ui/deployments");
    root.outerHTML = html;
    const newRoot = document.querySelector("[data-deployments-root]");
    restoreOpenState(newRoot, openState);
    bindDashboard(document);
  } catch (error) {
    const statusNode = document.querySelector("[data-ui-status]");
    if (statusNode && !statusNode.textContent) {
      statusNode.textContent = error.message;
    }
  } finally {
    deploymentsRefreshInFlight = false;
  }
}

function startDeploymentsPolling() {
  if (deploymentsRefreshTimer || typeof window === "undefined") {
    return;
  }

  deploymentsRefreshTimer = window.setInterval(() => {
    void refreshDeployments();
  }, DEPLOYMENTS_REFRESH_MS);
}

function captureOpenState(root) {
  const keys = new Set();
  if (!root) {
    return keys;
  }

  root.querySelectorAll("details[data-preserve-open]").forEach((node) => {
    if (node.open) {
      keys.add(node.dataset.preserveOpen);
    }
  });

  return keys;
}

function restoreOpenState(root, keys) {
  if (!root || !keys?.size) {
    return;
  }

  root.querySelectorAll("details[data-preserve-open]").forEach((node) => {
    node.open = keys.has(node.dataset.preserveOpen);
  });
}

function getCurrentPanelId() {
  if (typeof window === "undefined" || !window.location.hash) {
    return "add-repo";
  }

  return window.location.hash.slice(1) || "add-repo";
}

async function fetchHtml(url) {
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

async function readResponsePayload(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return null;
}

function isRepoMutation(action) {
  return /^\/api\/repos(?:\/[^/]+)?$/.test(action);
}

function isRepoDelete(action) {
  return /^\/api\/repos\/[^/]+$/.test(action);
}

function isManualDeploy(action) {
  return /^\/api\/repos\/[^/]+\/manual-deploy$/.test(action);
}

function isDeploymentAction(action) {
  return /^\/api\/deployments\/[^/]+(?:\/redeploy)?$/.test(action);
}

function normalizePath(url) {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}
