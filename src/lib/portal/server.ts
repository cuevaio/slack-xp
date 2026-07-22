import type {
  PortalAuthority,
  PortalMembershipInput,
  PortalToken,
  PortalTokenInput,
} from "@/lib/portal/types";

const DEFAULT_PORTAL_API_URL = "https://api.useportal.co";

export class PortalServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super("Portal is temporarily unavailable.");
    this.name = "PortalServiceError";
    this.status = status;
    this.code = code;
  }
}

type PortalControlPlaneOptions = {
  secret: string;
  apiUrl?: string;
  fetcher?: typeof fetch;
};

function parseToken(value: unknown): PortalToken | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("token" in value) ||
    !("expiresAt" in value) ||
    typeof value.token !== "string" ||
    typeof value.expiresAt !== "string"
  ) {
    return null;
  }
  return { token: value.token, expiresAt: value.expiresAt };
}

export function createPortalControlPlane({
  secret,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: PortalControlPlaneOptions): PortalAuthority {
  const baseUrl = apiUrl.replace(/\/$/u, "");

  async function post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new PortalServiceError(503, "portal_unavailable");
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        typeof payload === "object" &&
        payload !== null &&
        "code" in payload &&
        typeof payload.code === "string"
          ? payload.code
          : "portal_request_failed";
      throw new PortalServiceError(response.status, code);
    }
    return payload;
  }

  return {
    async ensureMembership({
      channelId,
      userId,
      claims,
    }: PortalMembershipInput) {
      await post(`/v1/channels/${encodeURIComponent(channelId)}/members`, {
        userId,
        claims,
      });
    },

    async mintToken({ channelId, userId, claims }: PortalTokenInput) {
      const token = parseToken(
        await post("/v1/tokens", {
          userId,
          claims,
          channels: { [channelId]: ["connect", "publish"] },
          ttl: "15m",
        }),
      );
      if (!token) {
        throw new PortalServiceError(502, "invalid_portal_response");
      }
      return token;
    },
  };
}
