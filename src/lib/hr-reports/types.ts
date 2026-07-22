import type { HR_REPORT_CATEGORIES } from "@/lib/hr-reports/domain";

export type HRReportCategory = (typeof HR_REPORT_CATEGORIES)[number];
export type HRReportState = "open" | "dismissed";

export type HRReportStableContext = {
  officeDay: string;
  officeChannelId: string;
  messageId: string;
};

export type MessageHRReportInput = HRReportStableContext & {
  category: HRReportCategory;
};

export type CreateMessageHRReportInput = MessageHRReportInput & {
  reporterId: string;
  reportId: string;
  createdAt: Date;
};

export type CreateMessageHRReportResult = {
  reportId: string;
  status: "created" | "already-reported";
};

export type PendingHRReportNotification = HRReportStableContext & {
  outboxId: string;
};

export type HRReportNotification = HRReportStableContext & {
  notificationId: string;
  type: "hr-report.ready";
  title: "HR Report ready for review";
  href: string;
};

export type HRReportRepository = {
  createMessageHRReport(
    input: CreateMessageHRReportInput,
  ): Promise<CreateMessageHRReportResult>;
  pendingHRReportNotifications(
    limit: number,
  ): Promise<PendingHRReportNotification[]>;
  markHRReportNotificationPublished(
    outboxId: string,
    publishedAt: Date,
  ): Promise<void>;
};

export type HRReportNotificationPublisher = {
  publishHRReportNotification(
    notification: HRReportNotification,
    operatorIds: readonly string[],
  ): Promise<void>;
};
