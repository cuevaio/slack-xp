import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { MockPortalUnavailableError } from "@/lib/portal/mock";
import { PortalServiceError } from "@/lib/portal/server";
import {
  issueGeneralPortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";

export const runtime = "nodejs";

export async function POST() {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }

  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  const adapters = createServiceAdapters(configuration);
  try {
    const session = await issueGeneralPortalSession({
      identity,
      onboarding: await adapters.neon.getNewHire(identity.id),
      portal: adapters.portal,
    });
    return Response.json(session, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    if (error instanceof PortalEligibilityError) {
      return Response.json({ error: "new_hire_ineligible" }, { status: 403 });
    }
    if (error instanceof PortalServiceError) {
      console.error(
        JSON.stringify({
          operation: "portal_session",
          authority: "portal",
          code: error.code,
          status: error.status,
        }),
      );
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    if (error instanceof MockPortalUnavailableError) {
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    throw error;
  }
}
