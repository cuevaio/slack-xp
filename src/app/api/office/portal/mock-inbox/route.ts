import { createServiceAdapters } from "@/lib/adapters";
import { getMockPortalAdapter } from "@/lib/adapters/mock";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { readAppConfiguration } from "@/lib/config";
import { toHRReportNotificationContent } from "@/lib/hr-reports/domain";
import type { OfficeInboxEntry } from "@/lib/portal/inbox";
import {
  type MockPortalInboxEntry,
  MockPortalUnavailableError,
} from "@/lib/portal/mock";
import {
  issueOfficePortalSession,
  type OfficePortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";

export const runtime = "nodejs";

type MockInboxContext =
  | { errorResponse: Response }
  | { identity: AuthenticatedNewHire; session: OfficePortalSession };

function portalUnavailableResponse(): Response {
  return Response.json({ error: "portal_unavailable" }, { status: 503 });
}

function handleMockPortalError(error: unknown): Response {
  if (error instanceof MockPortalUnavailableError) {
    return portalUnavailableResponse();
  }
  throw error;
}

function toOfficeInboxEntry(entry: MockPortalInboxEntry): OfficeInboxEntry {
  if (!entry.latest) {
    return { id: entry.channelId, unread: entry.unread };
  }

  return {
    id: entry.channelId,
    unread: entry.unread,
    latest: {
      text: entry.latest.text,
      sender: { id: entry.latest.senderId },
      at: entry.latest.at,
    },
  };
}

function readRequestedChannelId(
  body: unknown,
  allowedChannelIds: readonly string[],
): string | null {
  if (typeof body !== "object" || body === null || !("channelId" in body)) {
    return null;
  }

  const channelId = body.channelId;
  if (typeof channelId !== "string" || !allowedChannelIds.includes(channelId)) {
    return null;
  }
  return channelId;
}

async function getMockInboxContext(): Promise<MockInboxContext> {
  const configuration = readAppConfiguration();
  if (
    configuration.status !== "ready" ||
    configuration.serviceMode !== "mock" ||
    configuration.environment === "production"
  ) {
    return {
      errorResponse: Response.json({ error: "not_found" }, { status: 404 }),
    };
  }

  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return {
      errorResponse: Response.json(
        { error: "authentication_required" },
        { status: 401 },
      ),
    };
  }

  const adapters = createServiceAdapters(configuration);
  try {
    return {
      identity,
      session: await issueOfficePortalSession({
        identity,
        onboarding: await adapters.neon.getNewHire(identity.id),
        portal: adapters.portal,
      }),
    };
  } catch (error) {
    if (error instanceof PortalEligibilityError) {
      return {
        errorResponse: Response.json(
          { error: "new_hire_ineligible" },
          { status: 403 },
        ),
      };
    }
    return { errorResponse: handleMockPortalError(error) };
  }
}

export async function GET() {
  const context = await getMockInboxContext();
  if ("errorResponse" in context) {
    return context.errorResponse;
  }

  try {
    const channels = getMockPortalAdapter()
      .inbox(context.identity.id, context.session.channelIds)
      .map(toOfficeInboxEntry);
    const notifications = getMockPortalAdapter()
      .hrReportNotifications(context.identity.id)
      .map((notification) => ({
        id: notification.notificationId,
        type: notification.type,
        title: notification.title,
        data: toHRReportNotificationContent(notification),
        at: notification.at,
        read: notification.read,
      }));
    return Response.json({ channels, notifications });
  } catch (error) {
    return handleMockPortalError(error);
  }
}

export async function POST(request: Request) {
  const context = await getMockInboxContext();
  if ("errorResponse" in context) {
    return context.errorResponse;
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    "notificationId" in body &&
    typeof body.notificationId === "string"
  ) {
    try {
      getMockPortalAdapter().markHRReportNotificationRead(
        context.identity.id,
        body.notificationId,
      );
      return new Response(null, { status: 204 });
    } catch (error) {
      return handleMockPortalError(error);
    }
  }
  const channelId = readRequestedChannelId(body, context.session.channelIds);
  if (!channelId) {
    return Response.json({ error: "invalid_channel" }, { status: 422 });
  }

  try {
    getMockPortalAdapter().markInboxRead(context.identity.id, channelId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleMockPortalError(error);
  }
}
