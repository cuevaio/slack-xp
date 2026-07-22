import type { OfficeInvalidationEvent } from "@/lib/office-events/contract";

export const SEND_HOME_PRIVATE_REASON_MAX_LENGTH = 1_000;
export const EMPLOYMENT_PRIVATE_REASON_MAX_LENGTH = 1_000;
export const EMPLOYMENT_SYSTEM_EVENT_VERSION = 1 as const;
export const EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE = "system.event" as const;
export const SEND_HOME_SYSTEM_EVENT_TEXT =
  "An Operator sent a New Hire home for the rest of this Office Day.";
export const TERMINATION_SYSTEM_EVENT_TEXT =
  "An Operator terminated a New Hire from Portal Systems.";
export const REINSTATEMENT_SYSTEM_EVENT_TEXT =
  "An Operator reinstated a New Hire at Portal Systems.";

export class EmploymentActionError extends Error {
  constructor(
    readonly code:
      | "new_hire_not_found"
      | "report_not_found"
      | "request_conflict"
      | "termination_not_found"
      | "new_hire_deleted",
    message: string,
  ) {
    super(message);
    this.name = "EmploymentActionError";
  }
}

export type EmploymentAccessReason = "deleted" | "terminated" | "sent-home";

export type EmploymentAccessDecision =
  | { eligible: true; reason: null; until: null }
  | {
      eligible: false;
      reason: EmploymentAccessReason;
      until: Date | null;
    };

export type EmploymentAccessDeniedDecision = Extract<
  EmploymentAccessDecision,
  { eligible: false }
>;

export type SendHomeRequest = {
  requestId: string;
  targetNewHireId: string;
  privateReason: string;
  reportId?: string;
};

export type TerminationRequest = SendHomeRequest;

export type ReinstatementRequest = {
  requestId: string;
  targetNewHireId: string;
  privateReason: string;
};

export type EmploymentActionRecord = {
  actionId: string;
  requestId: string;
  action: "sent_home";
  operatorId: string;
  targetNewHireId: string;
  officeDay: string;
  expiresAt: Date;
  reportId: string | null;
  actedAt: Date;
  createdAt: Date;
};

export type RecordSendHomeInput = Omit<
  EmploymentActionRecord,
  "action" | "createdAt"
> & {
  privateReason: string;
};

export type RecordSendHomeResult = {
  status: "created" | "existing";
  action: EmploymentActionRecord;
};

export type TerminationRecord = {
  terminationId: string;
  requestId: string;
  operatorId: string;
  targetNewHireId: string;
  reportId: string | null;
  terminatedAt: Date;
  reinstatedAt: Date | null;
  createdAt: Date;
};

export type ReinstatementRecord = {
  reinstatementId: string;
  requestId: string;
  terminationId: string;
  operatorId: string;
  targetNewHireId: string;
  reinstatedAt: Date;
  createdAt: Date;
};

export type RecordTerminationInput = Omit<
  TerminationRecord,
  "reinstatedAt" | "createdAt"
> & { privateReason: string };

export type RecordReinstatementInput = Omit<
  ReinstatementRecord,
  "terminationId" | "createdAt"
> & { privateReason: string };

export type EmploymentState = {
  access: EmploymentAccessDecision;
  activeTermination: Pick<
    TerminationRecord,
    "terminationId" | "operatorId" | "terminatedAt"
  > | null;
};

export type PendingTerminationEffect = {
  effectId: string;
  action: "terminated" | "reinstated";
  operatorId: string;
  targetNewHireId: string;
  terminationId: string;
  officeDay: string;
  actedAt: Date;
  portalAccessReconciledAt: Date | null;
  publicEventPublishedAt: Date | null;
  invalidationPublishedAt: Date | null;
};

export type PendingEmploymentEffect = EmploymentActionRecord & {
  bansAppliedAt: Date | null;
  publicEventPublishedAt: Date | null;
  invalidationPublishedAt: Date | null;
};

export type EmploymentRepository = {
  recordSendHome(input: RecordSendHomeInput): Promise<RecordSendHomeResult>;
  getEmploymentAccess(
    newHireId: string,
    now: Date,
  ): Promise<EmploymentAccessDecision>;
  pendingEmploymentEffects(limit: number): Promise<PendingEmploymentEffect[]>;
  markEmploymentBansApplied(actionId: string, appliedAt: Date): Promise<void>;
  markEmploymentPublicEventPublished(
    actionId: string,
    publishedAt: Date,
  ): Promise<void>;
  markEmploymentInvalidationPublished(
    actionId: string,
    publishedAt: Date,
  ): Promise<void>;
  recordTermination(input: RecordTerminationInput): Promise<{
    status: "created" | "existing";
    termination: TerminationRecord;
  }>;
  recordReinstatement(input: RecordReinstatementInput): Promise<{
    status: "created" | "existing";
    reinstatement: ReinstatementRecord;
  }>;
  getEmploymentState(newHireId: string, now: Date): Promise<EmploymentState>;
  pendingTerminationEffects(limit: number): Promise<PendingTerminationEffect[]>;
  markTerminationPortalAccessReconciled(
    effectId: string,
    reconciledAt: Date,
  ): Promise<void>;
  markTerminationPublicEventPublished(
    effectId: string,
    publishedAt: Date,
  ): Promise<void>;
  markTerminationInvalidationPublished(
    effectId: string,
    publishedAt: Date,
  ): Promise<void>;
};

export type EmploymentInvalidationEvent = Extract<
  OfficeInvalidationEvent,
  { type: "employment.invalidated" }
>;

export type PublicSendHomeSystemEvent = {
  version: typeof EMPLOYMENT_SYSTEM_EVENT_VERSION;
  type: "employment.sent-home";
  eventKey: string;
  officeDay: string;
  operatorId: string;
  targetNewHireId: string;
  expiresAt: string;
  text: string;
};

export type PublicTerminationSystemEvent = {
  version: typeof EMPLOYMENT_SYSTEM_EVENT_VERSION;
  type: "employment.terminated" | "employment.reinstated";
  eventKey: string;
  officeDay: string;
  operatorId: string;
  targetNewHireId: string;
  terminationId: string;
  text: string;
};

export type SafePublicSendHomeSystemEventMessage = {
  id: string;
  channelId: string;
  senderId: string;
  timestamp: number;
  eventKey: string;
  operatorId: string;
  targetNewHireId: string;
  content: PublicSendHomeSystemEvent;
  status: "sent";
};

export type SafePublicTerminationSystemEventMessage = {
  id: string;
  channelId: string;
  senderId: string;
  timestamp: number;
  eventKey: string;
  operatorId: string;
  targetNewHireId: string;
  terminationId: string;
  action: "terminated" | "reinstated";
  content: PublicTerminationSystemEvent;
  status: "sent";
};

export type EmploymentPortalAuthority = {
  applySendHomeBans(input: {
    channelIds: readonly string[];
    newHireId: string;
    expiresAt: Date;
  }): Promise<void>;
  publishEmploymentInvalidation(
    event: EmploymentInvalidationEvent,
  ): Promise<void>;
  publishSendHomeSystemEvent(event: PublicSendHomeSystemEvent): Promise<void>;
  applyTerminationBans(input: {
    channelIds: readonly string[];
    newHireId: string;
  }): Promise<void>;
  reconcileReinstatementBans(input: {
    channelIds: readonly string[];
    newHireId: string;
    sentHomeUntil: Date | null;
  }): Promise<void>;
  publishTerminationSystemEvent(
    event: PublicTerminationSystemEvent,
  ): Promise<void>;
};

export type SendHomeResult = {
  actionId: string;
  status: "sent-home" | "already-sent-home";
  officeDay: string;
  expiresAt: Date;
};

export type TerminationResult = {
  terminationId: string;
  status: "terminated" | "already-terminated";
  terminatedAt: Date;
};

export type ReinstatementResult = {
  reinstatementId: string;
  terminationId: string;
  status: "reinstated" | "already-reinstated";
  reinstatedAt: Date;
};
