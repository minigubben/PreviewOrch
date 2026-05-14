export function serializeForm(form: HTMLFormElement): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = {};
  for (const element of Array.from(form.elements)) {
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      )
    ) {
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
