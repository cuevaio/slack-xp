export const HR_REPORT_CATEGORIES = [
  "harassment-or-bullying",
  "hate-or-discrimination",
  "threatening-behavior",
  "sexual-content",
] as const;

export const PROFILE_HR_REPORT_CATEGORIES = [
  "abusive-or-hateful-name",
  "abusive-or-explicit-picture",
  "impersonation",
] as const;

export const HR_REPORT_NOTIFICATION_CHANNEL_ID = "hr-reports";
export const HR_REPORT_NOTIFICATION_TYPE = "hr-report.ready";
export const MESSAGE_HR_REPORT_NOTIFICATION_TITLE =
  "Message HR Report ready for review";
export const PROFILE_HR_REPORT_NOTIFICATION_TITLE =
  "New Hire Profile HR Report ready for review";

// Retained as the message-notification contract name for existing consumers.
export const HR_REPORT_NOTIFICATION_TITLE =
  MESSAGE_HR_REPORT_NOTIFICATION_TITLE;

export type MessageHRReportCategory = (typeof HR_REPORT_CATEGORIES)[number];
export type ProfileHRReportCategory =
  (typeof PROFILE_HR_REPORT_CATEGORIES)[number];
export type HRReportCategory =
  | MessageHRReportCategory
  | ProfileHRReportCategory;
export type HRReportState = "open" | "dismissed";
export type HRReportSubjectType = "message" | "profile";

export type MessageHRReportStableContext = {
  subjectType: "message";
  officeDay: string;
  officeChannelId: string;
  messageId: string;
};

export type ProfileHRReportStableContext = {
  subjectType: "profile";
  profileId: string;
};

export type HRReportStableContext =
  | MessageHRReportStableContext
  | ProfileHRReportStableContext;

export type MessageHRReportInput = Omit<
  MessageHRReportStableContext,
  "subjectType"
> & {
  category: MessageHRReportCategory;
};

export type ProfileHRReportInput = ProfileHRReportStableContext & {
  category: ProfileHRReportCategory;
};

type CreateHRReportBase = {
  reporterId: string;
  reportId: string;
  createdAt: Date;
};

export type CreateMessageHRReportInput = CreateHRReportBase &
  MessageHRReportStableContext & {
    category: MessageHRReportCategory;
  };

export type CreateProfileHRReportInput = CreateHRReportBase &
  ProfileHRReportStableContext & {
    category: ProfileHRReportCategory;
  };

export type CreateHRReportInput =
  | CreateMessageHRReportInput
  | CreateProfileHRReportInput;

export type CreateHRReportResult = {
  reportId: string;
  status: "created" | "already-reported";
};

export type CreateMessageHRReportResult = CreateHRReportResult;

export type PendingHRReportNotification = HRReportStableContext & {
  outboxId: string;
};

type HRReportNotificationBase = {
  notificationId: string;
  type: typeof HR_REPORT_NOTIFICATION_TYPE;
};

export type HRReportNotificationContent =
  | (MessageHRReportStableContext & {
      title: typeof MESSAGE_HR_REPORT_NOTIFICATION_TITLE;
      href: string;
    })
  | (ProfileHRReportStableContext & {
      title: typeof PROFILE_HR_REPORT_NOTIFICATION_TITLE;
      href: string;
    });

export type HRReportNotification = HRReportNotificationBase &
  HRReportNotificationContent;

export type HRReportRepository = {
  createHRReport(input: CreateHRReportInput): Promise<CreateHRReportResult>;
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
