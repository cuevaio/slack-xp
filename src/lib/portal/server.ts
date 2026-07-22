import {
  resolveScriptedSystemEventPublication,
  SCRIPTED_SYSTEM_EVENT_MESSAGE_TYPE,
} from "@/lib/office-days/contract";
import type {
  ScriptedSystemEventOutboxEntry,
  ScriptedSystemEventPublisher,
} from "@/lib/office-days/types";
import {
  OFFICE_EVENT_MESSAGE_TYPE,
  OFFICE_EVENT_SENDERS,
  officeEventChannelId,
} from "@/lib/office-events/contract";
import type {
  PortalAuthority,
  PortalMembershipInput,
  PortalToken,
  PortalTokenInput,
} from "@/lib/portal/types";
import type {
  ProfileInvalidationEvent,
  ProfileInvalidationPublisher,
} from "@/lib/profiles/types";

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

    async mintToken({ channelIds, userId, claims }: PortalTokenInput) {
      const permissionsByChannel = Object.fromEntries(
        channelIds.map((channelId) => [channelId, ["connect", "publish"]]),
      );
      const token = parseToken(
        await post("/v1/tokens", {
          userId,
          claims,
          channels: permissionsByChannel,
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

type PortalProfilePublisherOptions = PortalControlPlaneOptions & {
  apiKey: string;
  now?: () => Date;
};

function isPublishAcknowledgement(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "number"
  );
}

type PortalMessagePublication = {
  channelId: string;
  content: unknown;
  failureCode: string;
  messageType:
    | typeof OFFICE_EVENT_MESSAGE_TYPE
    | typeof SCRIPTED_SYSTEM_EVENT_MESSAGE_TYPE;
  token: string;
};

function portalResponseErrorCode(
  payload: unknown,
  fallbackCode: string,
): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "code" in payload &&
    typeof payload.code === "string"
  ) {
    return payload.code;
  }

  return fallbackCode;
}

function createPortalMessagePublisher({
  apiKey,
  apiUrl,
  fetcher,
}: {
  apiKey: string;
  apiUrl: string;
  fetcher: typeof fetch;
}) {
  const baseUrl = apiUrl.replace(/\/$/u, "");

  return async function publishPortalMessage({
    channelId,
    content,
    failureCode,
    messageType,
    token,
  }: PortalMessagePublication): Promise<void> {
    let response: Response;
    try {
      response = await fetcher(
        `${baseUrl}/v1/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-portal-key": apiKey,
          },
          body: JSON.stringify({ type: messageType, content }),
          cache: "no-store",
        },
      );
    } catch {
      throw new PortalServiceError(503, "portal_unavailable");
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !isPublishAcknowledgement(payload)) {
      throw new PortalServiceError(
        response.ok ? 502 : response.status,
        portalResponseErrorCode(payload, failureCode),
      );
    }
  };
}

export function createPortalProfileInvalidationPublisher({
  secret,
  apiKey,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
  now = () => new Date(),
}: PortalProfilePublisherOptions): ProfileInvalidationPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiKey,
    apiUrl,
    fetcher,
  });

  return {
    async publishProfileInvalidation(event: ProfileInvalidationEvent) {
      const channelId = officeEventChannelId(now());
      const sender = {
        userId: OFFICE_EVENT_SENDERS.profiles,
        claims: { username: "Portal Profile Directory", avatar: null },
      };
      await controlPlane.ensureMembership({ channelId, ...sender });
      const token = await controlPlane.mintToken({
        channelIds: [channelId],
        ...sender,
      });

      await publishPortalMessage({
        channelId,
        content: event,
        failureCode: "portal_event_publish_failed",
        messageType: OFFICE_EVENT_MESSAGE_TYPE,
        token: token.token,
      });
    },
  };
}

export function createPortalScriptedSystemEventPublisher({
  secret,
  apiKey,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: Omit<PortalProfilePublisherOptions, "now">): ScriptedSystemEventPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiKey,
    apiUrl,
    fetcher,
  });

  return {
    async publishScriptedSystemEvent(entry: ScriptedSystemEventOutboxEntry) {
      const publication = resolveScriptedSystemEventPublication(entry);
      if (!publication) {
        throw new TypeError("Invalid scripted System Event publication.");
      }
      const { character } = publication;
      const sender = {
        userId: character.id,
        claims: {
          username: `${character.name} · Office Character`,
          avatar: null,
        },
      };
      await controlPlane.ensureMembership({
        channelId: entry.channelId,
        ...sender,
      });
      const token = await controlPlane.mintToken({
        channelIds: [entry.channelId],
        ...sender,
      });

      await publishPortalMessage({
        channelId: entry.channelId,
        content: entry.event,
        failureCode: "portal_system_event_publish_failed",
        messageType: SCRIPTED_SYSTEM_EVENT_MESSAGE_TYPE,
        token: token.token,
      });
    },
  };
}
