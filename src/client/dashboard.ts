import { serializeForm } from "./form";
import { readResponsePayload } from "./http";
import { bindManualTargetForms } from "./manual-targets";
import { getCurrentPanelId } from "./panels";
import { refreshDeployments, refreshRepoConfig } from "./refresh";
import {
  isDeploymentAction,
  isManualDeploy,
  isRepoDelete,
  isRepoMutation,
  normalizePath,
} from "./routes";

export function bindDashboard(root: ParentNode = document): void {
  bindApiForms(root);
  bindApiActions(root);
  bindManualTargetForms(root);
}

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
        statusNode.textContent =
          button.dataset.method === "DELETE" ? "Deployment destroyed." : "Redeploy started.";
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
