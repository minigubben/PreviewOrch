async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const method = form.dataset.method || form.method || "POST";
  const action = form.action;
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

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Request failed." }));
      throw new Error(payload.error || "Request failed.");
    }

    statusNode.textContent = "Saved. Reloading...";
    window.location.reload();
  } catch (error) {
    statusNode.textContent = error.message;
  }
}

async function runAction(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const statusNode = document.querySelector("[data-ui-status]");
  const confirmMessage = button.dataset.confirm;

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

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Action failed." }));
      throw new Error(payload.error || "Action failed.");
    }

    statusNode.textContent = "Action queued. Reloading...";
    window.location.reload();
  } catch (error) {
    statusNode.textContent = error.message;
  }
}

document.querySelectorAll("[data-api-form]").forEach((form) => {
  form.addEventListener("submit", submitForm);
});

document.querySelectorAll("[data-api-action]").forEach((button) => {
  button.addEventListener("click", runAction);
});

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
