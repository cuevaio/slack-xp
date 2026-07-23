type FetchPortalToken = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type PortalTokenSourceOptions = {
  fetcher?: FetchPortalToken;
  getAuthorizationToken?(): Promise<string | null>;
};

export function createPortalTokenSource({
  fetcher = fetch,
  getAuthorizationToken,
}: PortalTokenSourceOptions): () => Promise<string> {
  let inFlight: Promise<string> | undefined;

  return () => {
    if (inFlight) return inFlight;

    const request = (async () => {
      const authorizationToken = await getAuthorizationToken?.();
      if (getAuthorizationToken && !authorizationToken) {
        throw new Error("Portal authentication is temporarily unavailable.");
      }
      const response = await fetcher("/api/office/portal/token", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: authorizationToken
          ? { Authorization: `Bearer ${authorizationToken}` }
          : undefined,
        signal: AbortSignal.timeout(5_000),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof payload !== "object" || payload === null) {
        throw new Error("Portal authentication is temporarily unavailable.");
      }
      if (!("token" in payload) || typeof payload.token !== "string") {
        throw new Error("Portal authentication is temporarily unavailable.");
      }
      return payload.token;
    })();
    inFlight = request;
    const clear = () => {
      if (inFlight === request) inFlight = undefined;
    };
    void request.then(clear, clear);
    return request;
  };
}
