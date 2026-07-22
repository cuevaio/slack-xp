import { describe, expect, test } from "bun:test";
import type { ReadyAppConfiguration } from "@/lib/config";
import {
  formatOfficeTimestamp,
  millisecondsUntilNextOfficeDay,
  observeOfficeDayBoundary,
  officeDay,
} from "@/lib/portal/office-day";
import {
  MOCK_OFFICE_NOW_HEADER,
  officeNowForRequest,
} from "@/lib/portal/request-time";

class VisibleDocumentTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

describe("Office Day", () => {
  test("uses the UTC date immediately before, at, and after midnight", () => {
    expect(officeDay(new Date("2026-07-22T23:59:59.999Z"))).toBe("2026-07-22");
    expect(officeDay(new Date("2026-07-23T00:00:00.000Z"))).toBe("2026-07-23");
    expect(officeDay(new Date("2026-07-23T00:00:00.001Z"))).toBe("2026-07-23");
    expect(
      millisecondsUntilNextOfficeDay(new Date("2026-07-22T23:59:59.999Z")),
    ).toBe(1);
    expect(
      millisecondsUntilNextOfficeDay(new Date("2026-07-23T00:00:00.000Z")),
    ).toBe(86_400_000);
  });

  test("rechecks after visibility, sleep, focus, network recovery, and clock movement", () => {
    const recoveryEvents = ["visibilitychange", "pageshow", "focus", "online"];

    for (const eventName of recoveryEvents) {
      let now = new Date("2026-07-22T12:00:00.000Z");
      let transitions = 0;
      const windowTarget = new EventTarget();
      const documentTarget = new VisibleDocumentTarget();
      const timers = new Map<number, () => void>();
      let timerSequence = 0;
      const stop = observeOfficeDayBoundary({
        currentOfficeDay: "2026-07-22",
        documentTarget,
        now: () => now,
        onBoundary: () => {
          transitions += 1;
        },
        setTimer(callback) {
          timerSequence += 1;
          timers.set(timerSequence, callback);
          return timerSequence;
        },
        clearTimer(timer) {
          timers.delete(timer);
        },
        windowTarget,
      });

      now = new Date("2026-07-23T09:30:00.000Z");
      const target =
        eventName === "visibilitychange" ? documentTarget : windowTarget;
      target.dispatchEvent(new Event(eventName));

      expect(transitions, eventName).toBe(1);
      expect(timers.size, eventName).toBe(0);
      stop();
    }
  });

  test("fires the scheduled transition at the exact boundary", () => {
    let now = new Date("2026-07-22T23:59:59.999Z");
    let scheduled: (() => void) | undefined;
    let delay = 0;
    let transitions = 0;

    observeOfficeDayBoundary({
      currentOfficeDay: "2026-07-22",
      documentTarget: new VisibleDocumentTarget(),
      now: () => now,
      onBoundary: () => {
        transitions += 1;
      },
      setTimer(callback, nextDelay) {
        scheduled = callback;
        delay = nextDelay;
        return 1;
      },
      clearTimer() {},
      windowTarget: new EventTarget(),
    });

    expect(delay).toBe(1);
    now = new Date("2026-07-23T00:00:00.000Z");
    scheduled?.();
    expect(transitions).toBe(1);
  });

  test("formats canonical timestamps in the requested local timezone", () => {
    const timestamp = Date.parse("2026-07-22T16:30:00.000Z");

    expect(
      formatOfficeTimestamp(timestamp, "America/Los_Angeles", "en-US"),
    ).toBe("9:30 AM");
    expect(formatOfficeTimestamp(timestamp, "Asia/Tokyo", "en-US")).toBe(
      "1:30 AM",
    );
  });

  test("accepts the controlled request clock only in test mock mode", () => {
    const controlled = "2030-01-02T03:04:05.000Z";
    const fallback = new Date("2026-07-22T12:00:00.000Z");
    const requestHeaders = new Headers({
      [MOCK_OFFICE_NOW_HEADER]: controlled,
    });
    const mockConfiguration = {
      status: "ready",
      environment: "test",
      serviceMode: "mock",
      values: {},
    } satisfies ReadyAppConfiguration;
    const liveConfiguration = {
      status: "ready",
      environment: "production",
      serviceMode: "live",
      values: {},
    } satisfies ReadyAppConfiguration;

    expect(
      officeNowForRequest(requestHeaders, mockConfiguration, fallback),
    ).toEqual(new Date(controlled));
    expect(
      officeNowForRequest(requestHeaders, liveConfiguration, fallback),
    ).toBe(fallback);
  });
});
