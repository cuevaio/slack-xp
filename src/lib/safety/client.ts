"use client";

import { useEffect, useState } from "react";
import {
  MAX_SAFETY_PROJECTION_AGE_MS,
  resolveSafetyProjectionStatus,
  SAFETY_PROJECTION_TIMEOUT_MS,
  type SafetyProjectionSnapshot,
  type SafetyProjectionStatus,
} from "@/lib/safety/contract";

const SAFETY_CONTROL_REPAIR_INTERVAL_MS = 5_000;

export function useSafetyProjectionStatus(
  snapshot: SafetyProjectionSnapshot,
): SafetyProjectionStatus {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    setNow(Date.now());
    if (snapshot.status !== "success" || snapshot.dataUpdatedAt <= 0) return;
    const remaining =
      snapshot.dataUpdatedAt + MAX_SAFETY_PROJECTION_AGE_MS - Date.now();
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1, remaining + 1),
    );
    return () => window.clearTimeout(timeout);
  }, [snapshot.dataUpdatedAt, snapshot.status]);

  return resolveSafetyProjectionStatus(snapshot, now);
}

export function useApplicationSafetyControl(): "ready" | "unavailable" {
  const [status, setStatus] = useState<"ready" | "unavailable">("ready");

  useEffect(() => {
    let cancelled = false;
    async function verify(): Promise<void> {
      try {
        const response = await fetch("/api/office/safety-state", {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(SAFETY_PROJECTION_TIMEOUT_MS),
        });
        const payload: unknown = await response.json().catch(() => null);
        const available =
          response.ok &&
          typeof payload === "object" &&
          payload !== null &&
          "status" in payload &&
          payload.status === "available";
        if (!cancelled) setStatus(available ? "ready" : "unavailable");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    }

    void verify();
    const interval = window.setInterval(
      () => void verify(),
      SAFETY_CONTROL_REPAIR_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return status;
}
