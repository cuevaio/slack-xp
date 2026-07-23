const MILLISECONDS_PER_DAY = 86_400_000;

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

type RetentionPolicy = {
  days: number;
  retainedAt: Date;
};

function retentionPolicyFor(record: RetentionRecord): RetentionPolicy | null {
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
    case "outbox": {
      if (!record.complete) {
        return null;
      }
      return {
        days: APPLICATION_RETENTION_DAYS.outbox,
        retainedAt: record.retainedAt,
      };
    }
    case "termination": {
      if (!record.reversedAt) {
        return null;
      }
      return {
        days: APPLICATION_RETENTION_DAYS.reversedTermination,
        retainedAt: record.reversedAt,
      };
    }
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

  const candidates: RetentionCandidate[] = [];
  for (const record of records) {
    const policy = retentionPolicyFor(record);
    if (!policy) {
      continue;
    }

    const retainedTimestamp = policy.retainedAt.getTime();
    if (
      !Number.isFinite(retainedTimestamp) ||
      retainedTimestamp + policy.days * MILLISECONDS_PER_DAY > nowTimestamp
    ) {
      continue;
    }

    candidates.push({ kind: record.kind, id: record.id });
  }

  return candidates;
}
