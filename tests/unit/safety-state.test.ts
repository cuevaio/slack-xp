import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  MAX_SAFETY_PROJECTION_AGE_MS,
  resolveSafetyProjectionStatus,
  SAFETY_PROJECTION_ERROR_REPAIR_INTERVAL_MS,
  SAFETY_PROJECTION_REPAIR_INTERVAL_MS,
  SAFETY_PROJECTION_RETRY_COUNT,
  safetyProjectionRefetchInterval,
  safetyProjectionRetryDelay,
} from "@/lib/safety/contract";
import { isMaintenanceActive } from "@/lib/safety/server";

describe("safety-state policy", () => {
  test("uses bounded jitter without synchronized retry storms", () => {
    const retryDelay = safetyProjectionRetryDelay(0);
    const errorRepairDelay = safetyProjectionRefetchInterval("error");

    expect(SAFETY_PROJECTION_RETRY_COUNT).toBe(1);
    expect(retryDelay).toBeGreaterThanOrEqual(1_000);
    expect(retryDelay).toBeLessThan(2_000);
    expect(errorRepairDelay).toBeGreaterThanOrEqual(
      SAFETY_PROJECTION_ERROR_REPAIR_INTERVAL_MS,
    );
    expect(errorRepairDelay).toBeLessThan(
      SAFETY_PROJECTION_ERROR_REPAIR_INTERVAL_MS * 2,
    );
    expect(safetyProjectionRefetchInterval("success")).toBe(
      SAFETY_PROJECTION_REPAIR_INTERVAL_MS,
    );
  });

  test("uses TanStack's last successful projection after a background error", async () => {
    let available = true;
    const queryClient = new QueryClient();
    const observer = new QueryObserver(queryClient, {
      queryKey: ["safety-projection-test"],
      queryFn: async () => {
        if (!available) throw new Error("temporary outage");
        return [];
      },
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    available = false;
    const failedRefetch = await observer.refetch();

    expect(failedRefetch.status).toBe("error");
    expect(failedRefetch.isRefetchError).toBe(true);
    expect(failedRefetch.dataUpdatedAt).toBeGreaterThan(0);
    expect(
      resolveSafetyProjectionStatus(
        failedRefetch,
        failedRefetch.dataUpdatedAt + 1,
      ),
    ).toBe("ready");
    expect(
      resolveSafetyProjectionStatus(
        failedRefetch,
        failedRefetch.dataUpdatedAt + MAX_SAFETY_PROJECTION_AGE_MS + 1,
      ),
    ).toBe("unavailable");

    unsubscribe();
  });

  test("keeps fresh verified data through refetch failures and fails closed when stale", () => {
    const now = 100_000;
    const current = {
      status: "success",
      fetchStatus: "idle",
      isRefetchError: false,
      dataUpdatedAt: now,
    } as const;

    expect(resolveSafetyProjectionStatus(current, now)).toBe("ready");
    expect(
      resolveSafetyProjectionStatus({ ...current, status: "error" }, now),
    ).toBe("unavailable");
    expect(
      resolveSafetyProjectionStatus(
        { ...current, status: "error", isRefetchError: true },
        now,
      ),
    ).toBe("ready");
    expect(
      resolveSafetyProjectionStatus(
        {
          ...current,
          dataUpdatedAt: now - MAX_SAFETY_PROJECTION_AGE_MS - 1,
        },
        now,
      ),
    ).toBe("unavailable");
    expect(
      resolveSafetyProjectionStatus({ ...current, fetchStatus: "paused" }, now),
    ).toBe("ready");
    expect(
      resolveSafetyProjectionStatus(
        { ...current, fetchStatus: "unexpected" },
        now,
      ),
    ).toBe("unavailable");
    expect(
      resolveSafetyProjectionStatus(
        {
          ...current,
          status: "error",
          isRefetchError: true,
          dataUpdatedAt: 0,
        },
        now,
      ),
    ).toBe("unavailable");
    expect(
      resolveSafetyProjectionStatus(
        { ...current, status: "pending", dataUpdatedAt: 0 },
        now,
      ),
    ).toBe("loading");
    expect(
      resolveSafetyProjectionStatus(
        {
          status: "unexpected",
          fetchStatus: "idle",
          isRefetchError: false,
          dataUpdatedAt: now,
        },
        now,
      ),
    ).toBe("unavailable");
  });

  test("treats an invalid maintenance value as active", () => {
    expect(isMaintenanceActive({ PORTAL_MESSENGER_MAINTENANCE: "on" })).toBe(
      true,
    );
    expect(isMaintenanceActive({ PORTAL_MESSENGER_MAINTENANCE: "off" })).toBe(
      false,
    );
    expect(isMaintenanceActive({ PORTAL_MESSENGER_MAINTENANCE: "typo" })).toBe(
      true,
    );
  });
});
