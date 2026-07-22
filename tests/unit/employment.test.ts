import { describe, expect, test } from "bun:test";
import {
  employmentAccessDecision,
  officeDayExpiry,
  parseSendHomeRequest,
} from "@/lib/employment/domain";

describe("Send Home policy", () => {
  test("expires at the next UTC Office Day boundary", () => {
    expect(
      officeDayExpiry(new Date("2026-07-22T00:00:00.000Z")).toISOString(),
    ).toBe("2026-07-23T00:00:00.000Z");
    expect(
      officeDayExpiry(new Date("2026-07-22T23:59:59.999Z")).toISOString(),
    ).toBe("2026-07-23T00:00:00.000Z");
  });

  test("requires a stable request, target, and non-empty private reason", () => {
    expect(
      parseSendHomeRequest({
        requestId: "send-home-request-21",
        targetNewHireId: "user_target",
        privateReason: "  Unsafe conduct reviewed by an Operator.  ",
        reportId: "report-21",
      }),
    ).toEqual({
      requestId: "send-home-request-21",
      targetNewHireId: "user_target",
      privateReason: "Unsafe conduct reviewed by an Operator.",
      reportId: "report-21",
    });
    expect(
      parseSendHomeRequest({
        requestId: "send-home-request-21",
        targetNewHireId: "user_target",
        privateReason: "   ",
      }),
    ).toBeNull();
  });

  test("recovers after expiry without overriding deletion or Termination", () => {
    const now = new Date("2026-07-23T00:00:00.000Z");
    expect(
      employmentAccessDecision({
        now,
        sentHomeUntil: new Date("2026-07-23T00:00:00.000Z"),
        deletedAt: null,
        terminatedAt: null,
      }),
    ).toEqual({ eligible: true, reason: null, until: null });
    expect(
      employmentAccessDecision({
        now,
        sentHomeUntil: new Date("2026-07-24T00:00:00.000Z"),
        deletedAt: null,
        terminatedAt: new Date("2026-07-22T08:00:00.000Z"),
      }).reason,
    ).toBe("terminated");
    expect(
      employmentAccessDecision({
        now,
        sentHomeUntil: new Date("2026-07-23T00:00:00.000Z"),
        deletedAt: new Date("2026-07-22T08:00:00.000Z"),
        terminatedAt: null,
      }).reason,
    ).toBe("deleted");
  });
});
