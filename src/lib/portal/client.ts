type FetchPortalToken = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createPortalTokenSource(
  fetcher: FetchPortalToken = fetch,
): () => Promise<string> {
  return async () => {
    const response = await fetcher("/api/office/portal/token", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (
      !response.ok ||
      typeof payload !== "object" ||
      payload === null ||
      !("token" in payload) ||
      typeof payload.token !== "string"
    ) {
      throw new Error("Portal authentication is temporarily unavailable.");
    }
    return payload.token;
  };
}
