import { createServiceAdapters } from "@/lib/adapters";
import { getMockPortalAdapter } from "@/lib/adapters/mock";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { readAppConfiguration } from "@/lib/config";
import { parseOfficeEvent } from "@/lib/office-events/contract";
import { MockPortalUnavailableError } from "@/lib/portal/mock";
import { officeNowForRequest } from "@/lib/portal/request-controls";
import {
  issueOfficePortalSession,
  type OfficePortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";

export const runtime = "nodejs";

type MockEventContext =
  | { errorResponse: Response }
  | {
      identity: AuthenticatedNewHire;
      session: OfficePortalSession;
    };

function portalUnavailableResponse(): Response {
  return Response.json({ error: "portal_unavailable" }, { status: 503 });
}

async function getMockEventContext(
  request: Request,
): Promise<MockEventContext> {
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
    const now = officeNowForRequest(request.headers, configuration);
    const session = await issueOfficePortalSession({
      identity,
      onboarding: await adapters.neon.getNewHire(identity.id),
      portal: adapters.portal,
      now,
      employmentAccess: await adapters.neon.getEmploymentAccess(
        identity.id,
        now,
      ),
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

export async function GET(request: Request) {
  const context = await getMockEventContext(request);
  if ("errorResponse" in context) {
    return context.errorResponse;
  }

  try {
    return Response.json(
      getMockPortalAdapter().officeEvents(context.session.eventChannelId),
    );
  } catch (error) {
    if (error instanceof MockPortalUnavailableError) {
      return portalUnavailableResponse();
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const context = await getMockEventContext(request);
  if ("errorResponse" in context) {
    return context.errorResponse;
  }

  const event = parseOfficeEvent(await request.json().catch(() => null));
  if (
    event?.type !== "reaction.changed" ||
    event.actorId !== context.identity.id
  ) {
    return Response.json({ error: "invalid_reaction" }, { status: 422 });
  }

  try {
    return Response.json(
      await getMockPortalAdapter().sendOfficeEvent({
        channelId: context.session.eventChannelId,
        senderId: context.identity.id,
        content: event,
      }),
    );
  } catch (error) {
    if (error instanceof MockPortalUnavailableError) {
      return portalUnavailableResponse();
    }
    if (error instanceof TypeError) {
      return Response.json({ error: "invalid_reaction" }, { status: 422 });
    }
    throw error;
  }
}
