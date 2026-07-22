import type {
  HRReportNotification,
  HRReportNotificationPublisher,
} from "@/lib/hr-reports/types";
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

export function createPortalProfileInvalidationPublisher({
  secret,
  apiKey,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
  now = () => new Date(),
}: PortalProfilePublisherOptions): ProfileInvalidationPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const baseUrl = apiUrl.replace(/\/$/u, "");

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

      let response: Response;
      try {
        response = await fetcher(
          `${baseUrl}/v1/channels/${encodeURIComponent(channelId)}/messages`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token.token}`,
              "content-type": "application/json",
              "x-portal-key": apiKey,
            },
            body: JSON.stringify({
              type: OFFICE_EVENT_MESSAGE_TYPE,
              content: event,
            }),
            cache: "no-store",
          },
        );
      } catch {
        throw new PortalServiceError(503, "portal_unavailable");
      }

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isPublishAcknowledgement(payload)) {
        const code =
          typeof payload === "object" &&
          payload !== null &&
          "code" in payload &&
          typeof payload.code === "string"
            ? payload.code
            : "portal_event_publish_failed";
        throw new PortalServiceError(response.ok ? 502 : response.status, code);
      }
    },
  };
}

export const HR_REPORT_NOTIFICATION_CHANNEL_ID = "hr-reports";

export function createPortalHRReportNotificationPublisher({
  secret,
  apiKey,
  apiUrl = DEFAULT_PORTAL_API_URL,
  fetcher = fetch,
}: PortalProfilePublisherOptions): HRReportNotificationPublisher {
  const controlPlane = createPortalControlPlane({ secret, apiUrl, fetcher });
  const baseUrl = apiUrl.replace(/\/$/u, "");

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
      const token = await controlPlane.mintToken({
        channelIds: [HR_REPORT_NOTIFICATION_CHANNEL_ID],
        ...sender,
      });

      for (const operatorId of operatorIds) {
        let response: Response;
        try {
          response = await fetcher(
            `${baseUrl}/v1/channels/${HR_REPORT_NOTIFICATION_CHANNEL_ID}/messages`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token.token}`,
                "content-type": "application/json",
                "x-portal-key": apiKey,
              },
              body: JSON.stringify({
                type: notification.type,
                to: operatorId,
                content: {
                  title: notification.title,
                  href: notification.href,
                  officeDay: notification.officeDay,
                  officeChannelId: notification.officeChannelId,
                  messageId: notification.messageId,
                },
              }),
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
            "portal_notification_publish_failed",
          );
        }
      }
    },
  };
}
