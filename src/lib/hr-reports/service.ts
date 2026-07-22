import {
  type CreateHRReportInput,
  type CreateHRReportResult,
  type DismissHRReportResult,
  HR_REPORT_NOTIFICATION_TYPE,
  type HRReportInvalidationPublisher,
  type HRReportNotification,
  type HRReportNotificationPublisher,
  type HRReportRepository,
  MESSAGE_HR_REPORT_NOTIFICATION_TITLE,
  type MessageHRReportCategory,
  type PendingHRReportNotification,
  PROFILE_HR_REPORT_NOTIFICATION_TITLE,
  type ProfileHRReportCategory,
} from "@/lib/hr-reports/contract";
import { createHRReportDeepLink } from "@/lib/hr-reports/domain";
import {
  createOfficeEventKey,
  OFFICE_EVENT_VERSION,
} from "@/lib/office-events/contract";

const HR_REPORT_OUTBOX_BATCH_SIZE = 50;
const HR_REPORT_REVIEW_BATCH_SIZE = 50;

type SerializedHRReportReview<
  TReport extends Awaited<
    ReturnType<HRReportRepository["listHRReports"]>
  >[number],
> = TReport extends TReport
  ? Omit<TReport, "createdAt" | "updatedAt" | "resolution"> & {
      href: string;
      createdAt: string;
      updatedAt: string;
      resolution: {
        actionId: string;
        operatorId: string;
        action: "dismissed";
        privateNote: string | null;
        actedAt: string;
        createdAt: string;
      } | null;
    }
  : never;

export type HRReportReviewItem = SerializedHRReportReview<
  Awaited<ReturnType<HRReportRepository["listHRReports"]>>[number]
>;

export class HRReportReviewError extends Error {
  constructor(
    readonly code: "report_not_found",
    message: string,
  ) {
    super(message);
    this.name = "HRReportReviewError";
  }
}

function toReviewItem(
  appOrigin: string,
  report: Awaited<ReturnType<HRReportRepository["listHRReports"]>>[number],
): HRReportReviewItem {
  return {
    ...report,
    href: createHRReportDeepLink(appOrigin, report),
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    resolution: report.resolution
      ? {
          ...report.resolution,
          actedAt: report.resolution.actedAt.toISOString(),
          createdAt: report.resolution.createdAt.toISOString(),
        }
      : null,
  };
}

export async function listHRReportsForReview({
  repository,
  appOrigin,
}: {
  repository: HRReportRepository;
  appOrigin: string;
}): Promise<HRReportReviewItem[]> {
  const reports = await repository.listHRReports(HR_REPORT_REVIEW_BATCH_SIZE);
  return reports.map((report) => toReviewItem(appOrigin, report));
}

export async function dismissHRReport({
  repository,
  reportId,
  operatorId,
  privateNote,
  publisher,
  now = new Date(),
}: {
  repository: HRReportRepository;
  reportId: string;
  operatorId: string;
  privateNote: string | null;
  publisher?: HRReportInvalidationPublisher;
  now?: Date;
}): Promise<DismissHRReportResult> {
  const actionId = crypto.randomUUID();
  const result = await repository.dismissHRReport({
    actionId,
    reportId,
    operatorId,
    privateNote,
    actedAt: now,
  });
  if (!result) {
    throw new HRReportReviewError(
      "report_not_found",
      "The requested HR Report does not exist.",
    );
  }
  if (result.status === "dismissed" && publisher) {
    try {
      await publisher.publishHRReportInvalidation({
        version: OFFICE_EVENT_VERSION,
        type: "report.invalidated",
        eventKey: createOfficeEventKey("report.invalidated", actionId),
        occurredAt: now.toISOString(),
        reportId,
      });
    } catch {
      // This event is only an invalidation hint. Canonical Neon state is
      // committed and periodic query repair will converge connected Operators.
    }
  }
  return result;
}

export type SubmitHRReportResult = CreateHRReportResult & {
  notificationStatus: "sent" | "pending";
};

function toNotification(
  appOrigin: string,
  entry: PendingHRReportNotification,
): HRReportNotification {
  const shared = {
    notificationId: entry.outboxId,
    type: HR_REPORT_NOTIFICATION_TYPE,
    href: createHRReportDeepLink(appOrigin, entry),
  } as const;
  if (entry.subjectType === "profile") {
    return {
      ...shared,
      title: PROFILE_HR_REPORT_NOTIFICATION_TITLE,
      subjectType: "profile",
      profileId: entry.profileId,
    };
  }
  return {
    ...shared,
    title: MESSAGE_HR_REPORT_NOTIFICATION_TITLE,
    subjectType: "message",
    officeDay: entry.officeDay,
    officeChannelId: entry.officeChannelId,
    messageId: entry.messageId,
  };
}

export async function flushHRReportNotifications({
  repository,
  publisher,
  operatorIds,
  appOrigin,
}: {
  repository: HRReportRepository;
  publisher: HRReportNotificationPublisher;
  operatorIds: readonly string[];
  appOrigin: string;
}): Promise<number> {
  if (operatorIds.length === 0) return 0;
  const pending = await repository.pendingHRReportNotifications(
    HR_REPORT_OUTBOX_BATCH_SIZE,
  );
  let published = 0;
  for (const entry of pending) {
    await publisher.publishHRReportNotification(
      toNotification(appOrigin, entry),
      operatorIds,
    );
    await repository.markHRReportNotificationPublished(
      entry.outboxId,
      new Date(),
    );
    published += 1;
  }
  return published;
}

async function submitHRReport({
  repository,
  publisher,
  input,
  operatorIds,
  appOrigin,
}: {
  repository: HRReportRepository;
  publisher: HRReportNotificationPublisher;
  input: CreateHRReportInput;
  operatorIds: readonly string[];
  appOrigin: string;
}): Promise<SubmitHRReportResult> {
  const result = await repository.createHRReport(input);
  if (operatorIds.length === 0) {
    return { ...result, notificationStatus: "pending" };
  }
  try {
    await flushHRReportNotifications({
      repository,
      publisher,
      operatorIds,
      appOrigin,
    });
    return { ...result, notificationStatus: "sent" };
  } catch {
    return { ...result, notificationStatus: "pending" };
  }
}

type SubmissionDependencies = {
  repository: HRReportRepository;
  publisher: HRReportNotificationPublisher;
  reporterId: string;
  operatorIds: readonly string[];
  appOrigin: string;
  now?: Date;
};

export async function submitMessageHRReport({
  repository,
  publisher,
  reporterId,
  category,
  officeDay,
  officeChannelId,
  messageId,
  operatorIds,
  appOrigin,
  now = new Date(),
}: SubmissionDependencies & {
  category: MessageHRReportCategory;
  officeDay: string;
  officeChannelId: string;
  messageId: string;
}) {
  return submitHRReport({
    repository,
    publisher,
    input: {
      reportId: crypto.randomUUID(),
      reporterId,
      subjectType: "message",
      category,
      officeDay,
      officeChannelId,
      messageId,
      createdAt: now,
    },
    operatorIds,
    appOrigin,
  });
}

export async function submitProfileHRReport({
  repository,
  publisher,
  reporterId,
  category,
  profileId,
  operatorIds,
  appOrigin,
  now = new Date(),
}: SubmissionDependencies & {
  category: ProfileHRReportCategory;
  profileId: string;
}) {
  return submitHRReport({
    repository,
    publisher,
    input: {
      reportId: crypto.randomUUID(),
      reporterId,
      subjectType: "profile",
      category,
      profileId,
      createdAt: now,
    },
    operatorIds,
    appOrigin,
  });
}
