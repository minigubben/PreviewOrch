export function initPanelSelector(): void {
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
      trigger.classList.toggle("bg-zinc-800", active);
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

  const initial = window.location.hash
    ? window.location.hash.slice(1)
    : triggers[0]?.dataset.panelTarget;
  const fallback = triggers[0]?.dataset.panelTarget || "add-repo";
  activate(initial && byId.has(initial) ? initial : fallback);
}

export function getCurrentPanelId(): string {
  if (!window.location.hash) {
    return "add-repo";
  }

  return window.location.hash.slice(1) || "add-repo";
}
