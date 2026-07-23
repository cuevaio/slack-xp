import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import type { MessageRemovalRepository } from "@/lib/message-removals/contract";
import { parseMessageRemovalChannelQuery } from "@/lib/message-removals/domain";
import { listMessageRemovals } from "@/lib/message-removals/service";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import { officeDay } from "@/lib/portal/office-day";
import { officeNowForRequest } from "@/lib/portal/request-controls";
import {
  SAFETY_PROJECTION_TIMEOUT_MS,
  safetyProjectionUnavailableResponse,
  safetyResponseHeaders,
} from "@/lib/safety/contract";
import {
  logSafetyEvent,
  requestCorrelationId,
  type SafetyBoundaryOptions,
  withSafetyDependencyTimeout,
} from "@/lib/safety/server";

export const runtime = "nodejs";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
} as const;

export async function handleMessageRemovalQuery(
  request: Request,
  repository: MessageRemovalRepository,
  now: Date,
  options: SafetyBoundaryOptions = {},
): Promise<Response> {
  const correlationId =
    options.correlationId ?? requestCorrelationId(request.headers);
  const responseHeaders = safetyResponseHeaders(correlationId);
  const officeChannelId = parseMessageRemovalChannelQuery(
    new URL(request.url).searchParams.get("officeChannelId"),
    officeDay(now),
  );
  if (!officeChannelId) {
    return Response.json(
      { error: "invalid_office_channel" },
      { status: 422, headers: responseHeaders },
    );
  }
  try {
    const removals = await withSafetyDependencyTimeout(
      listMessageRemovals({ repository, officeChannelId }),
      options.timeoutMs ?? SAFETY_PROJECTION_TIMEOUT_MS,
    );
    return Response.json({ removals }, { headers: responseHeaders });
  } catch {
    (options.logger ?? logSafetyEvent)({
      operation: "message_removal_projection",
      correlationId,
      authority: "neon",
      status: "unavailable",
      officeChannelId,
    });
    return safetyProjectionUnavailableResponse(correlationId);
  }
}

export async function GET(request: Request) {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }
  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const adapters = createServiceAdapters(configuration);
  const correlationId = requestCorrelationId(request.headers);
  let onboarding: OnboardingSnapshot | null;
  try {
    onboarding = await withSafetyDependencyTimeout(
      adapters.neon.getNewHire(identity.id),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
  } catch {
    logSafetyEvent({
      operation: "message_removal_eligibility",
      correlationId,
      authority: "neon",
      status: "unavailable",
    });
    return safetyProjectionUnavailableResponse(correlationId);
  }
  if (!onboarding?.completedAt || onboarding.step !== "complete") {
    return Response.json(
      { error: "new_hire_ineligible" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return handleMessageRemovalQuery(
    request,
    adapters.neon,
    officeNowForRequest(request.headers, configuration),
    { correlationId },
  );
}
