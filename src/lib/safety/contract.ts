export const SAFETY_PROJECTION_TIMEOUT_MS = 5_000;
export const MAX_SAFETY_PROJECTION_AGE_MS = 45_000;

export type SafetyProjectionStatus = "loading" | "ready" | "unavailable";

export type SafetyProjectionSnapshot = {
  status: string;
  fetchStatus: string;
  isRefetchError: boolean;
  dataUpdatedAt: number;
};

export function resolveSafetyProjectionStatus(
  snapshot: SafetyProjectionSnapshot,
  now = Date.now(),
): SafetyProjectionStatus {
  if (snapshot.status === "pending" && snapshot.dataUpdatedAt === 0) {
    return "loading";
  }
  if (
    snapshot.status !== "success" ||
    (snapshot.fetchStatus !== "idle" && snapshot.fetchStatus !== "fetching") ||
    snapshot.isRefetchError ||
    snapshot.dataUpdatedAt <= 0 ||
    now - snapshot.dataUpdatedAt > MAX_SAFETY_PROJECTION_AGE_MS
  ) {
    return "unavailable";
  }
  return "ready";
}

export function maintenanceUnavailableResponse(
  correlationId: string,
): Response {
  return Response.json(
    {
      error: "maintenance_active",
      authority: "application",
      correlationId,
    },
    {
      status: 503,
      headers: safetyResponseHeaders(correlationId),
    },
  );
}

export function safetyProjectionUnavailableResponse(
  correlationId: string,
): Response {
  return Response.json(
    { error: "safety_projection_unavailable", correlationId },
    {
      status: 503,
      headers: safetyResponseHeaders(correlationId),
    },
  );
}

export function safetyResponseHeaders(correlationId: string) {
  return {
    "Cache-Control": "no-store, private",
    "X-Correlation-Id": correlationId,
  } as const;
}
