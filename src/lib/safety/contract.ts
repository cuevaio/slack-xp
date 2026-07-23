export const SAFETY_PROJECTION_TIMEOUT_MS = 5_000;
export const MAX_SAFETY_PROJECTION_AGE_MS = 45_000;
export const SAFETY_PROJECTION_REPAIR_INTERVAL_MS = 30_000;
export const SAFETY_PROJECTION_ERROR_REPAIR_INTERVAL_MS = 10_000;
export const SAFETY_PROJECTION_RETRY_COUNT = 1;

export type SafetyProjectionStatus = "loading" | "ready" | "unavailable";

export type SafetyProjectionSnapshot = {
  status: string;
  fetchStatus: string;
  isRefetchError: boolean;
  dataUpdatedAt: number;
};

export function safetyProjectionRetryDelay(attemptIndex: number): number {
  const baseDelay = Math.min(1_000 * 2 ** attemptIndex, 5_000);
  return baseDelay + Math.floor(Math.random() * baseDelay);
}

export function safetyProjectionRefetchInterval(status: string): number {
  if (status !== "error") return SAFETY_PROJECTION_REPAIR_INTERVAL_MS;
  return (
    SAFETY_PROJECTION_ERROR_REPAIR_INTERVAL_MS +
    Math.floor(Math.random() * SAFETY_PROJECTION_ERROR_REPAIR_INTERVAL_MS)
  );
}

export function resolveSafetyProjectionStatus(
  snapshot: SafetyProjectionSnapshot,
  now = Date.now(),
): SafetyProjectionStatus {
  if (snapshot.status === "pending" && snapshot.dataUpdatedAt === 0) {
    return "loading";
  }
  if (
    snapshot.fetchStatus !== "idle" &&
    snapshot.fetchStatus !== "fetching" &&
    snapshot.fetchStatus !== "paused"
  ) {
    return "unavailable";
  }
  if (
    snapshot.dataUpdatedAt <= 0 ||
    now - snapshot.dataUpdatedAt > MAX_SAFETY_PROJECTION_AGE_MS
  ) {
    return "unavailable";
  }
  if (
    snapshot.status === "success" ||
    (snapshot.status === "error" && snapshot.isRefetchError)
  ) {
    return "ready";
  }
  return "unavailable";
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
