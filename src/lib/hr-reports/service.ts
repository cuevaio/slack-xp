import {
  type CreateHRReportInput,
  type CreateHRReportResult,
  HR_REPORT_NOTIFICATION_TYPE,
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

const HR_REPORT_OUTBOX_BATCH_SIZE = 50;

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
