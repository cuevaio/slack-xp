import { createServiceAdapters } from "@/lib/adapters";
import { configuredOperatorUserIds } from "@/lib/auth/operator";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { flushHRReportNotifications } from "@/lib/hr-reports/service";
import { flushMessageRemovalInvalidations } from "@/lib/message-removals/service";
import { repairOfficeDayOnEntry } from "@/lib/office-days/cron";
import { MockPortalUnavailableError } from "@/lib/portal/mock";
import { officeNowForRequest } from "@/lib/portal/request-controls";
import { PortalServiceError } from "@/lib/portal/server";
import {
  issueOfficePortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";
import { flushProfileInvalidations } from "@/lib/profiles/propagation";
import {
  SAFETY_PROJECTION_TIMEOUT_MS,
  safetyProjectionUnavailableResponse,
} from "@/lib/safety/contract";
import { portalOrNeonAuthority } from "@/lib/safety/failure-authority";
import {
  logSafetyEvent,
  requestCorrelationId,
  withSafetyDependencyTimeout,
} from "@/lib/safety/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const correlationId = requestCorrelationId(request.headers);
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
    await flushProfileInvalidations(adapters.neon, adapters.portal);
    const now = officeNowForRequest(request.headers, configuration);
    const employmentAccess = await withSafetyDependencyTimeout(
      adapters.neon.getEmploymentAccess(identity.id, now),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
    if (!employmentAccess.eligible) {
      throw new PortalEligibilityError();
    }
    await repairOfficeDayOnEntry({ adapters, now, correlationId });
    try {
      await flushMessageRemovalInvalidations({
        repository: adapters.neon,
        publisher: adapters.portal,
      });
    } catch (error) {
      logSafetyEvent({
        operation: "message_removal_invalidation_retry",
        correlationId,
        authority: portalOrNeonAuthority(error),
        status: "pending",
      });
    }
    try {
      await flushHRReportNotifications({
        repository: adapters.neon,
        publisher: adapters.portal,
        operatorIds:
          configuration.serviceMode === "mock"
            ? ["user_mock_operator"]
            : configuredOperatorUserIds(),
        appOrigin:
          configuration.values.APP_ORIGIN ?? new URL(request.url).origin,
      });
    } catch (error) {
      logSafetyEvent({
        operation: "hr_report_notification_retry",
        correlationId,
        authority: portalOrNeonAuthority(error),
        status: "pending",
      });
    }
    const onboarding = await withSafetyDependencyTimeout(
      adapters.neon.getNewHire(identity.id),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
    const session = await issueOfficePortalSession({
      identity,
      onboarding,
      now,
      portal: adapters.portal,
      employmentAccess,
    });
    return Response.json(session, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    if (error instanceof PortalEligibilityError) {
      return Response.json({ error: "new_hire_ineligible" }, { status: 403 });
    }
    if (error instanceof PortalServiceError) {
      logSafetyEvent({
        operation: "portal_session",
        correlationId,
        authority: "portal",
        status: error.status,
      });
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    if (error instanceof MockPortalUnavailableError) {
      logSafetyEvent({
        operation: "portal_session",
        correlationId,
        authority: "portal",
        status: "unavailable",
      });
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    logSafetyEvent({
      operation: "portal_session_safety_state",
      correlationId,
      authority: "neon",
      status: "unavailable",
    });
    return safetyProjectionUnavailableResponse(correlationId);
  }
}
