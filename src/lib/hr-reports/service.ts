import { createHRReportDeepLink } from "@/lib/hr-reports/domain";
import type {
  HRReportCategory,
  HRReportNotificationPublisher,
  HRReportRepository,
  HRReportStableContext,
} from "@/lib/hr-reports/types";

const HR_REPORT_OUTBOX_BATCH_SIZE = 50;

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
      {
        notificationId: entry.outboxId,
        type: "hr-report.ready",
        title: "HR Report ready for review",
        officeDay: entry.officeDay,
        officeChannelId: entry.officeChannelId,
        messageId: entry.messageId,
        href: createHRReportDeepLink(appOrigin, entry),
      },
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
}: {
  repository: HRReportRepository;
  publisher: HRReportNotificationPublisher;
  reporterId: string;
  category: HRReportCategory;
  operatorIds: readonly string[];
  appOrigin: string;
  now?: Date;
} & HRReportStableContext) {
  const result = await repository.createMessageHRReport({
    reportId: crypto.randomUUID(),
    reporterId,
    category,
    officeDay,
    officeChannelId,
    messageId,
    createdAt: now,
  });
  if (operatorIds.length === 0) {
    return { ...result, notificationStatus: "pending" as const };
  }
  try {
    await flushHRReportNotifications({
      repository,
      publisher,
      operatorIds,
      appOrigin,
    });
    return { ...result, notificationStatus: "sent" as const };
  } catch {
    return { ...result, notificationStatus: "pending" as const };
  }
}
