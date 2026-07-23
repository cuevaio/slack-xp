import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { ProfileBatchError } from "@/lib/profiles/domain";
import { readProfileBatch } from "@/lib/profiles/service";
import type { ProfileRepository } from "@/lib/profiles/types";
import { SAFETY_PROJECTION_TIMEOUT_MS } from "@/lib/safety/contract";
import {
  logSafetyEvent,
  requestCorrelationId,
  type SafetyLogger,
  withSafetyDependencyTimeout,
} from "@/lib/safety/server";

export const runtime = "nodejs";

export async function handleProfileBatchRequest(
  request: Request,
  repository: ProfileRepository,
  options: {
    correlationId?: string;
    logger?: SafetyLogger;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const correlationId =
    options.correlationId ?? requestCorrelationId(request.headers);
  const responseHeaders = {
    "Cache-Control": "no-store, private",
    "X-Correlation-Id": correlationId,
  } as const;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_profile_batch" },
      { status: 400, headers: responseHeaders },
    );
  }

  try {
    let clerkUserIds: unknown;
    if (payload && typeof payload === "object" && "clerkUserIds" in payload) {
      clerkUserIds = payload.clerkUserIds;
    }

    const profiles = await withSafetyDependencyTimeout(
      readProfileBatch(repository, clerkUserIds),
      options.timeoutMs ?? SAFETY_PROJECTION_TIMEOUT_MS,
    );
    return Response.json({ profiles }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof ProfileBatchError) {
      return Response.json(
        { error: "invalid_profile_batch", message: error.message },
        { status: 400, headers: responseHeaders },
      );
    }
    (options.logger ?? logSafetyEvent)({
      operation: "profile_batch",
      correlationId,
      authority: "neon",
      status: "unavailable",
    });
    return Response.json(
      { error: "safety_projection_unavailable", correlationId },
      { status: 503, headers: responseHeaders },
    );
  }
}

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }

  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  return handleProfileBatchRequest(
    request,
    createServiceAdapters(configuration).neon,
  );
}
