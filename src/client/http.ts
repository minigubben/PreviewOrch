export type ResponsePayload = {
  error?: string;
  id?: string;
};

export async function fetchHtml(url: string): Promise<string> {
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

export async function readResponsePayload(response: Response): Promise<ResponsePayload | null> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<ResponsePayload>;
  }
  return null;
}
