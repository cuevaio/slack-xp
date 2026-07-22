import type { OfficeInvalidationEvent } from "@/lib/office-events/contract";

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
export const HR_REPORT_PRIVATE_NOTE_MAX_LENGTH = 1_000;
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
export type HRReportState = "open" | "dismissed" | "removed";
export type HRReportSubjectType = "message" | "profile";
export type HRReportOperatorAction = "dismissed";
export type HRReportDismissalStatus = "dismissed" | "already-dismissed";
export type HRReportInvalidationEvent = Extract<
  OfficeInvalidationEvent,
  { type: "report.invalidated" }
>;

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

export type HRReportResolution = {
  actionId: string;
  operatorId: string;
  action: HRReportOperatorAction;
  privateNote: string | null;
  actedAt: Date;
  createdAt: Date;
};

type HRReportReviewRecordBase = {
  reportId: string;
  reporterId: string;
  state: HRReportState;
  createdAt: Date;
  updatedAt: Date;
  resolution: HRReportResolution | null;
};

export type HRReportReviewRecord =
  | (MessageHRReportStableContext &
      HRReportReviewRecordBase & { category: MessageHRReportCategory })
  | (ProfileHRReportStableContext &
      HRReportReviewRecordBase & { category: ProfileHRReportCategory });

type SerializedHRReportResolution = Omit<
  HRReportResolution,
  "actedAt" | "createdAt"
> & {
  actedAt: string;
  createdAt: string;
};

type SerializedHRReportReviewRecord<TRecord extends HRReportReviewRecord> =
  TRecord extends HRReportReviewRecord
    ? Omit<TRecord, "createdAt" | "updatedAt" | "resolution"> & {
        href: string;
        createdAt: string;
        updatedAt: string;
        resolution: SerializedHRReportResolution | null;
      }
    : never;

export type HRReportReviewItem =
  SerializedHRReportReviewRecord<HRReportReviewRecord>;

export type HRReportDismissalRequest = {
  reportId: string;
  privateNote: string | null;
};

export type HRReportDismissalResponse = {
  reportId: string;
  status: HRReportDismissalStatus;
};

export type DismissHRReportInput = {
  actionId: string;
  reportId: string;
  operatorId: string;
  privateNote: string | null;
  actedAt: Date;
};

export type DismissHRReportResult = {
  status: HRReportDismissalStatus;
  report: HRReportReviewRecord;
};

export type OperatorActionRecord = {
  actionId: string;
  operatorId: string;
  targetType: "hr_report" | "message_removal";
  targetId: string;
  action: HRReportOperatorAction | "removed";
  privateNote: string | null;
  actedAt: Date;
  createdAt: Date;
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
  listHRReports(limit: number): Promise<HRReportReviewRecord[]>;
  dismissHRReport(
    input: DismissHRReportInput,
  ): Promise<DismissHRReportResult | null>;
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

export type HRReportInvalidationPublisher = {
  publishHRReportInvalidation(event: HRReportInvalidationEvent): Promise<void>;
};
