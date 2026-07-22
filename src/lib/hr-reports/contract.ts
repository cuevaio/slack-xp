export const HR_REPORT_CATEGORIES = [
  "harassment-or-bullying",
  "hate-or-discrimination",
  "threatening-behavior",
  "sexual-content",
] as const;

export const HR_REPORT_NOTIFICATION_CHANNEL_ID = "hr-reports";
export const HR_REPORT_NOTIFICATION_TYPE = "hr-report.ready";
export const HR_REPORT_NOTIFICATION_TITLE = "HR Report ready for review";

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
  type: typeof HR_REPORT_NOTIFICATION_TYPE;
  title: typeof HR_REPORT_NOTIFICATION_TITLE;
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
