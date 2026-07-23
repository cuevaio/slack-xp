import { describe, expect, test } from "bun:test";
import {
  MAX_SAFETY_PROJECTION_AGE_MS,
  resolveSafetyProjectionStatus,
} from "@/lib/safety/contract";
import { isMaintenanceActive } from "@/lib/safety/server";

describe("safety-state policy", () => {
  test("fails closed for unknown, failed, refetch-failed, and stale projections", () => {
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
      resolveSafetyProjectionStatus({ ...current, isRefetchError: true }, now),
    ).toBe("unavailable");
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
