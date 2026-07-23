import { describe, expect, test } from "bun:test";
import {
  APPLICATION_RETENTION_DAYS,
  type RetentionRecord,
  selectRetentionCandidates,
} from "@/lib/db/retention";

const now = new Date("2026-07-23T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

describe("application-owned retention selection", () => {
  test("selects expired workflow and Office Day records at exact policy boundaries", () => {
    expect(APPLICATION_RETENTION_DAYS).toEqual({
      hrReport: 90,
      operatorAction: 90,
      officeDay: 30,
      messageRemoval: 30,
      outbox: 30,
      reversedTermination: 90,
    });
    const records: RetentionRecord[] = [
      { kind: "hr-report", id: "report-old", retainedAt: daysAgo(90) },
      { kind: "hr-report", id: "report-current", retainedAt: daysAgo(89) },
      {
        kind: "operator-action",
        id: "audit-old",
        retainedAt: daysAgo(91),
      },
      { kind: "office-day", id: "day-old", retainedAt: daysAgo(30) },
      {
        kind: "message-removal",
        id: "removal-current",
        retainedAt: daysAgo(29),
      },
      {
        kind: "outbox",
        id: "outbox-published",
        retainedAt: daysAgo(30),
        complete: true,
      },
      {
        kind: "outbox",
        id: "outbox-pending",
        retainedAt: daysAgo(100),
        complete: false,
      },
    ];

    expect(selectRetentionCandidates(records, now)).toEqual([
      { kind: "hr-report", id: "report-old" },
      { kind: "operator-action", id: "audit-old" },
      { kind: "office-day", id: "day-old" },
      { kind: "outbox", id: "outbox-published" },
    ]);
  });

  test("retains active Terminations indefinitely and ages reversed Terminations from reversal", () => {
    const records: RetentionRecord[] = [
      {
        kind: "termination",
        id: "termination-active",
        retainedAt: daysAgo(500),
        reversedAt: null,
      },
      {
        kind: "termination",
        id: "termination-recently-reversed",
        retainedAt: daysAgo(500),
        reversedAt: daysAgo(89),
      },
      {
        kind: "termination",
        id: "termination-expired",
        retainedAt: daysAgo(500),
        reversedAt: daysAgo(90),
      },
    ];

    expect(selectRetentionCandidates(records, now)).toEqual([
      { kind: "termination", id: "termination-expired" },
    ]);
  });

  test("rejects invalid current instants and ignores invalid retention instants", () => {
    expect(() => selectRetentionCandidates([], new Date(Number.NaN))).toThrow(
      "Retention selection requires a valid current instant.",
    );

    expect(
      selectRetentionCandidates(
        [
          {
            kind: "hr-report",
            id: "report-with-invalid-date",
            retainedAt: new Date(Number.NaN),
          },
        ],
        now,
      ),
    ).toEqual([]);
  });
});
