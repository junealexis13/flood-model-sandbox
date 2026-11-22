export function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE ?? "";
  return `${base}${path}`;
}

export async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      const text = body.detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return "";
        })
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
  } catch {
    /* The body was not JSON. */
  }
  return response.statusText || "Request failed.";
}
