import {
  EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
  type EmploymentInvalidationEvent,
  type EmploymentPortalAuthority,
  type PublicSendHomeSystemEvent,
  type PublicTerminationSystemEvent,
} from "@/lib/employment/contract";
import {
  HR_REPORT_NOTIFICATION_CHANNEL_ID,
  type HRReportInvalidationEvent,
  type HRReportInvalidationPublisher,
  type HRReportNotification,
  type HRReportNotificationPublisher,
} from "@/lib/hr-reports/contract";
import { toHRReportNotificationContent } from "@/lib/hr-reports/domain";
import type {
  MessageRemovalInvalidationEvent,
  MessageRemovalInvalidationPublisher,
} from "@/lib/message-removals/contract";
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
import { officeChannelId } from "@/lib/portal/channels";
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
import { SAFETY_PROJECTION_TIMEOUT_MS } from "@/lib/safety/contract";

const DEFAULT_PORTAL_API_URL = "https://api.useportal.co";
const DEFAULT_PORTAL_REALTIME_URL = "https://realtime.useportal.co";
const OBSERVER_READER_USER_ID = "portal-messenger-observer-reader";

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
}: PortalControlPlaneOptions): PortalAuthority &
  Pick<
    EmploymentPortalAuthority,
    "applySendHomeBans" | "applyTerminationBans" | "reconcileReinstatementBans"
  > {
  const baseUrl = apiUrl.replace(/\/$/u, "");

  async function request(
    method: "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(SAFETY_PROJECTION_TIMEOUT_MS),
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

  const post = (path: string, body: unknown) => request("POST", path, body);

  return {
    async applySendHomeBans({ channelIds, newHireId, expiresAt }) {
      await Promise.all(
        channelIds.map((channelId) =>
          post(`/v1/channels/${encodeURIComponent(channelId)}/bans`, {
            userId: newHireId,
            expiresAt: expiresAt.toISOString(),
          }),
        ),
      );
    },

    async applyTerminationBans({ channelIds, newHireId }) {
      await Promise.all(
        channelIds.map((channelId) =>
          post(`/v1/channels/${encodeURIComponent(channelId)}/bans`, {
            userId: newHireId,
          }),
        ),
      );
    },

    async reconcileReinstatementBans({ channelIds, newHireId, sentHomeUntil }) {
      await Promise.all(
        channelIds.map((channelId) => {
          const bansPath = `/v1/channels/${encodeURIComponent(channelId)}/bans`;
          if (sentHomeUntil) {
            return post(bansPath, {
              userId: newHireId,
              expiresAt: sentHomeUntil.toISOString(),
            });
          }
          return request(
            "DELETE",
            `${bansPath}/${encodeURIComponent(newHireId)}`,
          );
        }),
      );
    },

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

    async mintToken({
      channelIds,
      userId,
      claims,
      capabilities,
    }: PortalTokenInput) {
      const permissionsByChannel = Object.fromEntries(
        channelIds.map((channelId) => [
          channelId,
          capabilities ?? ["connect", "publish"],
        ]),
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

export function createPortalObserverHistoryReader({
  secret,
  apiKey,
  apiUrl = DEFAULT_PORTAL_API_URL,
  realtimeUrl = DEFAULT_PORTAL_REALTIME_URL,
  fetcher = fetch,
}: PortalControlPlaneOptions & {
  apiKey: string;
  realtimeUrl?: string;
}) {
  const portal = createPortalControlPlane({ secret, apiUrl, fetcher });
  const baseRealtimeUrl = realtimeUrl.replace(/\/$/u, "");

  return {
    async readChannelHistory(channelId: string): Promise<readonly unknown[]> {
      const identity = {
        userId: OBSERVER_READER_USER_ID,
        claims: { username: "Portal Messenger Observer", avatar: null },
      };
      await portal.ensureMembership({ channelId, ...identity });
      const { token } = await portal.mintToken({
        channelIds: [channelId],
        capabilities: ["connect"],
        ...identity,
      });

      let response: Response;
      try {
        const url = new URL(
          `${baseRealtimeUrl}/v1/channels/${encodeURIComponent(channelId)}/history`,
        );
        url.searchParams.set("limit", "50");
        response = await fetcher(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-portal-key": apiKey,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(SAFETY_PROJECTION_TIMEOUT_MS),
        });
      } catch {
        throw new PortalServiceError(503, "portal_unavailable");
      }

      const payload: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("msgs" in payload) ||
        !Array.isArray(payload.msgs)
      ) {
        throw new PortalServiceError(
          response.ok ? 502 : response.status,
          portalResponseErrorCode(payload, "portal_history_failed"),
        );
      }

      return payload.msgs.map((message) =>
        typeof message === "object" && message !== null
          ? {
              ...message,
              channelId,
              status: "sent",
              unread: false,
            }
          : message,
      );
    },
  };
}

export function createPortalEmploymentPublisher({
  secret,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: PortalPublisherOptions): Pick<
  EmploymentPortalAuthority,
  | "publishEmploymentInvalidation"
  | "publishSendHomeSystemEvent"
  | "publishTerminationSystemEvent"
> {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiUrl,
    fetcher,
    secret,
  });
  const sender = {
    userId: OFFICE_EVENT_SENDERS.operations,
    claims: { username: "Portal Systems Operations", avatar: null },
  };

  return {
    async publishEmploymentInvalidation(event: EmploymentInvalidationEvent) {
      const channelId = officeEventChannelId(new Date(event.occurredAt));
      await controlPlane.ensureMembership({ channelId, ...sender });
      await publishPortalMessage({
        channelId,
        content: event,
        failureCode: "portal_event_publish_failed",
        messageType: OFFICE_EVENT_MESSAGE_TYPE,
        senderId: sender.userId,
      });
    },

    async publishSendHomeSystemEvent(event: PublicSendHomeSystemEvent) {
      const channelId = officeChannelId(
        "all-hands",
        new Date(`${event.officeDay}T00:00:00.000Z`),
      );
      await controlPlane.ensureMembership({ channelId, ...sender });
      await publishPortalMessage({
        channelId,
        content: event,
        failureCode: "portal_system_event_publish_failed",
        messageType: EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
        senderId: sender.userId,
      });
    },

    async publishTerminationSystemEvent(event: PublicTerminationSystemEvent) {
      const channelId = officeChannelId(
        "all-hands",
        new Date(`${event.officeDay}T00:00:00.000Z`),
      );
      await controlPlane.ensureMembership({ channelId, ...sender });
      await publishPortalMessage({
        channelId,
        content: event,
        failureCode: "portal_system_event_publish_failed",
        messageType: EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
        senderId: sender.userId,
      });
    },
  };
}

type PortalPublisherOptions = PortalControlPlaneOptions & {
  apiKey: string;
};

type PortalProfilePublisherOptions = PortalPublisherOptions & {
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
  messageType: string;
  senderId: string;
  to?: string;
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
  apiUrl,
  fetcher,
  secret,
}: {
  apiUrl: string;
  fetcher: typeof fetch;
  secret: string;
}) {
  const baseUrl = apiUrl.replace(/\/$/u, "");

  return async function publishPortalMessage({
    channelId,
    content,
    failureCode,
    messageType,
    senderId,
    to,
  }: PortalMessagePublication): Promise<void> {
    let response: Response;
    try {
      response = await fetcher(
        `${baseUrl}/v1/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            senderId,
            type: messageType,
            ...(to ? { to } : {}),
            content,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(SAFETY_PROJECTION_TIMEOUT_MS),
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
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
  now = () => new Date(),
}: PortalProfilePublisherOptions): ProfileInvalidationPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiUrl,
    fetcher,
    secret,
  });

  return {
    async publishProfileInvalidation(event: ProfileInvalidationEvent) {
      const channelId = officeEventChannelId(now());
      const sender = {
        userId: OFFICE_EVENT_SENDERS.profiles,
        claims: { username: "Portal Profile Directory", avatar: null },
      };
      await controlPlane.ensureMembership({ channelId, ...sender });

      await publishPortalMessage({
        channelId,
        content: event,
        failureCode: "portal_event_publish_failed",
        messageType: OFFICE_EVENT_MESSAGE_TYPE,
        senderId: sender.userId,
      });
    },
  };
}

export function createPortalHRReportInvalidationPublisher({
  secret,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: PortalPublisherOptions): HRReportInvalidationPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiUrl,
    fetcher,
    secret,
  });

  return {
    async publishHRReportInvalidation(event: HRReportInvalidationEvent) {
      const channelId = officeEventChannelId(new Date(event.occurredAt));
      const sender = {
        userId: OFFICE_EVENT_SENDERS.operations,
        claims: { username: "Portal Systems Operations", avatar: null },
      };
      await controlPlane.ensureMembership({ channelId, ...sender });
      await publishPortalMessage({
        channelId,
        content: event,
        failureCode: "portal_event_publish_failed",
        messageType: OFFICE_EVENT_MESSAGE_TYPE,
        senderId: sender.userId,
      });
    },
  };
}

export function createPortalMessageRemovalInvalidationPublisher({
  secret,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: PortalPublisherOptions): MessageRemovalInvalidationPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiUrl,
    fetcher,
    secret,
  });

  return {
    async publishMessageRemovalInvalidation(
      event: MessageRemovalInvalidationEvent,
    ) {
      const channelId = officeEventChannelId(new Date(event.occurredAt));
      const sender = {
        userId: OFFICE_EVENT_SENDERS.operations,
        claims: { username: "Portal Systems Operations", avatar: null },
      };
      await controlPlane.ensureMembership({ channelId, ...sender });
      await publishPortalMessage({
        channelId,
        content: event,
        failureCode: "portal_event_publish_failed",
        messageType: OFFICE_EVENT_MESSAGE_TYPE,
        senderId: sender.userId,
      });
    },
  };
}

export function createPortalScriptedSystemEventPublisher({
  secret,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: PortalPublisherOptions): ScriptedSystemEventPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiUrl,
    fetcher,
    secret,
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

      await publishPortalMessage({
        channelId: entry.channelId,
        content: entry.event,
        failureCode: "portal_system_event_publish_failed",
        messageType: SCRIPTED_SYSTEM_EVENT_MESSAGE_TYPE,
        senderId: sender.userId,
      });
    },
  };
}

export function createPortalHRReportNotificationPublisher({
  secret,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: PortalPublisherOptions): HRReportNotificationPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const publishPortalMessage = createPortalMessagePublisher({
    apiUrl,
    fetcher,
    secret,
  });

  return {
    async publishHRReportNotification(
      notification: HRReportNotification,
      operatorIds: readonly string[],
    ) {
      const sender = {
        userId: OFFICE_EVENT_SENDERS.operations,
        claims: { username: "Portal Systems HR", avatar: null },
      };
      await Promise.all([
        controlPlane.ensureMembership({
          channelId: HR_REPORT_NOTIFICATION_CHANNEL_ID,
          ...sender,
        }),
        ...operatorIds.map((operatorId) =>
          controlPlane.ensureMembership({
            channelId: HR_REPORT_NOTIFICATION_CHANNEL_ID,
            userId: operatorId,
            claims: { username: "Operator", avatar: null },
          }),
        ),
      ]);
      const content = toHRReportNotificationContent(notification);

      for (const operatorId of operatorIds) {
        await publishPortalMessage({
          channelId: HR_REPORT_NOTIFICATION_CHANNEL_ID,
          content,
          failureCode: "portal_notification_publish_failed",
          messageType: notification.type,
          senderId: sender.userId,
          to: operatorId,
        });
      }
    },
  };
}
