import { readResponsePayload } from "./http";

type ManualTargetOptions = {
  defaultBranch: string;
  branches: string[];
  pullRequests: Array<{ number: number; label: string }>;
};

type ManualTargetOptionsPayload = {
  defaultBranch?: string;
  branches?: string[];
  pullRequests?: Array<{ number?: number; label?: string }>;
  error?: string;
};

export function bindManualTargetForms(root: ParentNode): void {
  root.querySelectorAll<HTMLFormElement>("[data-manual-target-form]").forEach((form) => {
    if (form.dataset.boundManualTargets === "true") {
      return;
    }
    form.dataset.boundManualTargets = "true";

    const repoId = form.dataset.repoId;
    const repoDefaultBranch = String(form.dataset.defaultBranch || "main").trim() || "main";
    const targetTypeInput = form.querySelector<HTMLSelectElement>("[data-manual-target-type]");
    const targetValueInput = form.querySelector<HTMLSelectElement>("[data-manual-target-value]");
    const statusNode = form.querySelector<HTMLElement>("[data-manual-target-status]");
    const refreshButton = form.querySelector<HTMLButtonElement>("[data-manual-target-refresh]");
    if (!repoId || !targetTypeInput || !targetValueInput || !statusNode) {
      return;
    }

    let options: ManualTargetOptions = {
      defaultBranch: repoDefaultBranch,
      branches: [],
      pullRequests: [],
    };
    let optionsLoaded = false;

    const setOptions = (): void => {
      const targetType = targetTypeInput.value;
      const currentValue = targetValueInput.value;
      targetValueInput.innerHTML = "";

      if (targetType === "default-branch") {
        const option = document.createElement("option");
        option.value = options.defaultBranch;
        option.textContent = options.defaultBranch
          ? `Default (${options.defaultBranch})`
          : "Default branch";
        targetValueInput.append(option);
        targetValueInput.value = options.defaultBranch;
        targetValueInput.disabled = true;
        statusNode.textContent = "Deploys the configured default branch.";
        return;
      }

      const source =
        targetType === "pr"
          ? options.pullRequests.map((entry) => ({
              value: String(entry.number),
              label: entry.label,
            }))
          : options.branches.map((branch) => ({
              value: branch,
              label: branch,
            }));
      if (!source.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = targetType === "pr" ? "No PR refs found" : "No branch refs found";
        targetValueInput.append(option);
        targetValueInput.disabled = true;
        statusNode.textContent = "No deployable refs were returned from git.";
        return;
      }

      for (const item of source) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        targetValueInput.append(option);
      }

      const hasCurrent = source.some((item) => item.value === currentValue);
      targetValueInput.value = hasCurrent ? currentValue : (source[0]?.value ?? "");
      targetValueInput.disabled = false;
      statusNode.textContent =
        targetType === "pr"
          ? `Loaded ${source.length} PR refs from git.`
          : `Loaded ${source.length} branch refs from git.`;
    };

    const loadOptions = async (): Promise<void> => {
      statusNode.textContent = "Loading branches and PR refs from git...";
      targetValueInput.disabled = true;
      targetValueInput.innerHTML = `<option value="">Loading targets...</option>`;

      try {
        const response = await fetch(`/api/repos/${repoId}/manual-target-options`, {
          headers: {
            "X-Requested-With": "fetch",
          },
        });
        const payload = (await readResponsePayload(response)) as ManualTargetOptionsPayload | null;

        if (!response.ok) {
          throw new Error(payload?.error || "Unable to load manual deploy targets.");
        }

        options = normalizeManualTargetOptions(payload, repoDefaultBranch);
        optionsLoaded = true;
      } catch (error) {
        options = {
          defaultBranch: repoDefaultBranch,
          branches: [],
          pullRequests: [],
        };
        statusNode.textContent =
          error instanceof Error ? error.message : "Unable to load manual deploy targets.";
      }

      setOptions();
    };

    targetTypeInput.addEventListener("change", () => {
      if (!optionsLoaded) {
        void loadOptions();
        return;
      }
      setOptions();
    });

    targetTypeInput.addEventListener("focus", () => {
      if (!optionsLoaded) {
        void loadOptions();
      }
    });

    targetValueInput.addEventListener("focus", () => {
      if (!optionsLoaded) {
        void loadOptions();
      }
    });

    refreshButton?.addEventListener("click", () => {
      void loadOptions();
    });

    statusNode.textContent = "Load branch and PR refs from git before deploying.";
    const panel = form.closest<HTMLElement>("[data-panel-id]");
    if (!panel || !panel.classList.contains("hidden")) {
      void loadOptions();
    }
  });
}

function normalizeManualTargetOptions(
  payload: ManualTargetOptionsPayload | null,
  repoDefaultBranch: string,
): ManualTargetOptions {
  return {
    defaultBranch: String(payload?.defaultBranch || repoDefaultBranch).trim() || repoDefaultBranch,
    branches: Array.isArray(payload?.branches) ? payload.branches.map(String) : [],
    pullRequests: Array.isArray(payload?.pullRequests)
      ? payload.pullRequests
          .map((entry) => ({
            number: Number(entry?.number),
            label: String(entry?.label || `PR #${entry?.number ?? ""}`).trim(),
          }))
          .filter((entry) => Number.isInteger(entry.number) && entry.number > 0 && entry.label)
      : [],
  };
}
