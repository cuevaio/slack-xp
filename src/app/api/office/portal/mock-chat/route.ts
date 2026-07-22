import { createServiceAdapters } from "@/lib/adapters";
import { getMockPortalAdapter } from "@/lib/adapters/mock";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { parseChatContent } from "@/lib/portal/chat";
import { MockPortalUnavailableError } from "@/lib/portal/mock";
import {
  issueGeneralPortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";

export const runtime = "nodejs";

async function mockChatContext() {
  const configuration = readAppConfiguration();
  if (
    configuration.status !== "ready" ||
    configuration.serviceMode !== "mock" ||
    configuration.environment === "production"
  ) {
    return { response: Response.json({ error: "not_found" }, { status: 404 }) };
  }

  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return {
      response: Response.json(
        { error: "authentication_required" },
        { status: 401 },
      ),
    };
  }

  const adapters = createServiceAdapters(configuration);
  try {
    const session = await issueGeneralPortalSession({
      identity,
      onboarding: await adapters.neon.getNewHire(identity.id),
      portal: adapters.portal,
    });
    return { identity, session };
  } catch (error) {
    if (error instanceof PortalEligibilityError) {
      return {
        response: Response.json(
          { error: "new_hire_ineligible" },
          { status: 403 },
        ),
      };
    }
    if (error instanceof MockPortalUnavailableError) {
      return {
        response: Response.json(
          { error: "portal_unavailable" },
          { status: 503 },
        ),
      };
    }
    throw error;
  }
}

export async function GET() {
  const context = await mockChatContext();
  if ("response" in context) return context.response;

  try {
    return Response.json({
      messages: await getMockPortalAdapter().history(context.session.channelId),
    });
  } catch (error) {
    if (error instanceof MockPortalUnavailableError) {
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const context = await mockChatContext();
  if ("response" in context) return context.response;

  const body: unknown = await request.json().catch(() => null);
  const content = parseChatContent(body);
  if (!content) {
    return Response.json({ error: "invalid_message" }, { status: 422 });
  }

  try {
    return Response.json(
      await getMockPortalAdapter().sendMessage({
        channelId: context.session.channelId,
        senderId: context.identity.id,
        content,
      }),
    );
  } catch (error) {
    if (error instanceof MockPortalUnavailableError) {
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    throw error;
  }
}
