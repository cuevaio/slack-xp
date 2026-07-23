const DAY_MS = 86_400_000;

export const APPLICATION_RETENTION_DAYS = {
  hrReport: 90,
  operatorAction: 90,
  officeDay: 30,
  messageRemoval: 30,
  outbox: 30,
  reversedTermination: 90,
} as const;

type TimedRetentionRecord<Kind extends string> = {
  kind: Kind;
  id: string;
  retainedAt: Date;
};

export type RetentionRecord =
  | TimedRetentionRecord<"hr-report">
  | TimedRetentionRecord<"operator-action">
  | TimedRetentionRecord<"office-day">
  | TimedRetentionRecord<"message-removal">
  | (TimedRetentionRecord<"outbox"> & { complete: boolean })
  | (TimedRetentionRecord<"termination"> & { reversedAt: Date | null });

export type RetentionCandidate = Pick<RetentionRecord, "kind" | "id">;

function retentionAge(record: RetentionRecord): {
  days: number;
  retainedAt: Date;
} | null {
  switch (record.kind) {
    case "hr-report":
      return {
        days: APPLICATION_RETENTION_DAYS.hrReport,
        retainedAt: record.retainedAt,
      };
    case "operator-action":
      return {
        days: APPLICATION_RETENTION_DAYS.operatorAction,
        retainedAt: record.retainedAt,
      };
    case "office-day":
      return {
        days: APPLICATION_RETENTION_DAYS.officeDay,
        retainedAt: record.retainedAt,
      };
    case "message-removal":
      return {
        days: APPLICATION_RETENTION_DAYS.messageRemoval,
        retainedAt: record.retainedAt,
      };
    case "outbox":
      return record.complete
        ? {
            days: APPLICATION_RETENTION_DAYS.outbox,
            retainedAt: record.retainedAt,
          }
        : null;
    case "termination":
      return record.reversedAt
        ? {
            days: APPLICATION_RETENTION_DAYS.reversedTermination,
            retainedAt: record.reversedAt,
          }
        : null;
  }
}

export function selectRetentionCandidates(
  records: readonly RetentionRecord[],
  now: Date = new Date(),
): RetentionCandidate[] {
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(nowTimestamp)) {
    throw new TypeError(
      "Retention selection requires a valid current instant.",
    );
  }

  return records.flatMap((record) => {
    const policy = retentionAge(record);
    if (!policy) return [];
    const retainedTimestamp = policy.retainedAt.getTime();
    if (
      !Number.isFinite(retainedTimestamp) ||
      retainedTimestamp + policy.days * DAY_MS > nowTimestamp
    ) {
      return [];
    }
    return [{ kind: record.kind, id: record.id }];
  });
}
