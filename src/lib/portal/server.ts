import { OFFICE_CHANNEL_DEFINITIONS } from "@/lib/portal/channels";

const PORTAL_API_URL = "https://api.useportal.co";

type PortalIdentity = {
  id: string;
  name: string;
  imageUrl: string | null;
};

async function portalRequest(secret: string, path: string, body: unknown) {
  const response = await fetch(`${PORTAL_API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Portal request failed.");
  return payload;
}

export async function createPortalSession(
  secret: string,
  identity: PortalIdentity,
) {
  const claims = { username: identity.name, avatar: identity.imageUrl };
  const channelIds = OFFICE_CHANNEL_DEFINITIONS.map(({ slug }) => slug);

  await Promise.all(
    channelIds.map((channelId) =>
      portalRequest(secret, `/v1/channels/${channelId}/members`, {
        userId: identity.id,
        claims,
      }),
    ),
  );
  const permissions = Object.fromEntries(
    channelIds.map((channelId) => [channelId, ["connect", "publish"]]),
  );
  const payload = await portalRequest(secret, "/v1/tokens", {
    userId: identity.id,
    claims,
    channels: permissions,
    ttl: "15m",
  });
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("token" in payload) ||
    typeof payload.token !== "string"
  ) {
    throw new Error("Portal returned an invalid token response.");
  }
  return { token: payload.token, channelIds };
}
