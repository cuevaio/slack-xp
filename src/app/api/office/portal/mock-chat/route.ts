import { createServiceAdapters } from "@/lib/adapters";
import { getMockPortalAdapter } from "@/lib/adapters/mock";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { readAppConfiguration } from "@/lib/config";
import { isOfficeChannelSlug } from "@/lib/portal/channels";
import { parseChatContent } from "@/lib/portal/chat";
import { MockPortalUnavailableError } from "@/lib/portal/mock";
import {
  issueOfficePortalSession,
  type OfficePortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";

export const runtime = "nodejs";

type MockChatContext =
  | { errorResponse: Response }
  | {
      identity: AuthenticatedNewHire;
      session: OfficePortalSession;
    };

function portalUnavailableResponse(): Response {
  return Response.json({ error: "portal_unavailable" }, { status: 503 });
}

async function getMockChatContext(): Promise<MockChatContext> {
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
    const session = await issueOfficePortalSession({
      identity,
      onboarding: await adapters.neon.getNewHire(identity.id),
      portal: adapters.portal,
    });
    return { identity, session };
  } catch (error) {
    if (error instanceof PortalEligibilityError) {
      return {
        errorResponse: Response.json(
          { error: "new_hire_ineligible" },
          { status: 403 },
        ),
      };
    }
    if (error instanceof MockPortalUnavailableError) {
      return { errorResponse: portalUnavailableResponse() };
    }
    throw error;
  }
}

function resolveRequestedChannel(
  request: Request,
  session: OfficePortalSession,
): string | null {
  const requestedSlug =
    new URL(request.url).searchParams.get("channel") ?? "general";
  if (!isOfficeChannelSlug(requestedSlug)) {
    return null;
  }
  return (
    session.channelIds.find((channelId) =>
      channelId.startsWith(`${requestedSlug}:`),
    ) ?? null
  );
}

export async function GET(request: Request) {
  const context = await getMockChatContext();
  if ("errorResponse" in context) {
    return context.errorResponse;
  }
  const channelId = resolveRequestedChannel(request, context.session);
  if (!channelId) {
    return Response.json({ error: "invalid_channel" }, { status: 404 });
  }
  const before = new URL(request.url).searchParams.get("before") ?? undefined;

  try {
    return Response.json(
      await getMockPortalAdapter().historyPage(channelId, {
        ...(before ? { before } : {}),
        limit: 50,
      }),
    );
  } catch (error) {
    if (error instanceof MockPortalUnavailableError) {
      return portalUnavailableResponse();
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const context = await getMockChatContext();
  if ("errorResponse" in context) {
    return context.errorResponse;
  }
  const channelId = resolveRequestedChannel(request, context.session);
  if (!channelId) {
    return Response.json({ error: "invalid_channel" }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  const content = parseChatContent(body);
  if (!content) {
    return Response.json({ error: "invalid_message" }, { status: 422 });
  }

  try {
    return Response.json(
      await getMockPortalAdapter().sendMessage({
        channelId,
        senderId: context.identity.id,
        content,
      }),
    );
  } catch (error) {
    if (error instanceof MockPortalUnavailableError) {
      return portalUnavailableResponse();
    }
    throw error;
  }
}
