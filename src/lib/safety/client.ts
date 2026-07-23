"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  MAX_SAFETY_PROJECTION_AGE_MS,
  resolveSafetyProjectionStatus,
  SAFETY_PROJECTION_TIMEOUT_MS,
  type SafetyProjectionSnapshot,
  type SafetyProjectionStatus,
} from "@/lib/safety/contract";

const SAFETY_CONTROL_REPAIR_INTERVAL_MS = 5_000;
const SAFETY_CONTROL_ERROR_REPAIR_INTERVAL_MS = 2_000;
const APPLICATION_SAFETY_QUERY_KEY = ["application-safety-control"] as const;

export function useSafetyProjectionStatus(
  snapshot: SafetyProjectionSnapshot,
): SafetyProjectionStatus {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    setNow(Date.now());
    if (snapshot.dataUpdatedAt <= 0) return;
    const remaining =
      snapshot.dataUpdatedAt + MAX_SAFETY_PROJECTION_AGE_MS - Date.now();
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1, remaining + 1),
    );
    return () => window.clearTimeout(timeout);
  }, [snapshot.dataUpdatedAt]);

  return resolveSafetyProjectionStatus(snapshot, now);
}

export function useApplicationSafetyControl(): "ready" | "unavailable" {
  const query = useQuery<"available" | "maintenance">({
    queryKey: APPLICATION_SAFETY_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/office/safety-state", {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(SAFETY_PROJECTION_TIMEOUT_MS),
        ]),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (
        response.ok &&
        typeof payload === "object" &&
        payload !== null &&
        "status" in payload &&
        payload.status === "available"
      ) {
        return "available";
      }
      if (
        response.status === 503 &&
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        payload.error === "maintenance_active"
      ) {
        return "maintenance";
      }
      throw new Error("Application safety control is temporarily unavailable.");
    },
    staleTime: SAFETY_CONTROL_REPAIR_INTERVAL_MS,
    refetchInterval: (currentQuery) =>
      currentQuery.state.status === "error"
        ? SAFETY_CONTROL_ERROR_REPAIR_INTERVAL_MS +
          Math.floor(Math.random() * SAFETY_CONTROL_ERROR_REPAIR_INTERVAL_MS)
        : SAFETY_CONTROL_REPAIR_INTERVAL_MS,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const projectionStatus = useSafetyProjectionStatus(query);

  return query.data === "maintenance" || projectionStatus === "unavailable"
    ? "unavailable"
    : "ready";
}
