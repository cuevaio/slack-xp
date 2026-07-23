import { describe, expect, test } from "bun:test";
import {
  EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
  EMPLOYMENT_SYSTEM_EVENT_VERSION,
  REINSTATEMENT_SYSTEM_EVENT_TEXT,
  SEND_HOME_SYSTEM_EVENT_TEXT,
  TERMINATION_SYSTEM_EVENT_TEXT,
} from "@/lib/employment/contract";
import {
  employmentAccessDecision,
  officeDayExpiry,
  parsePublicSendHomeSystemEventMessage,
  parsePublicTerminationSystemEventMessage,
  parseReinstatementRequest,
  parseSendHomeRequest,
  parseTerminationRequest,
} from "@/lib/employment/domain";
import { OFFICE_EVENT_SENDERS } from "@/lib/office-events/contract";

describe("Send Home policy", () => {
  test("expires at the next UTC Office Day boundary", () => {
    expect(
      officeDayExpiry(new Date("2026-07-22T00:00:00.000Z")).toISOString(),
    ).toBe("2026-07-23T00:00:00.000Z");
    expect(
      officeDayExpiry(new Date("2026-07-22T23:59:59.999Z")).toISOString(),
    ).toBe("2026-07-23T00:00:00.000Z");
  });

  test("requires a stable request, target, and non-empty private reason", () => {
    expect(
      parseSendHomeRequest({
        requestId: "send-home-request-21",
        targetNewHireId: "user_target",
        privateReason: "  Unsafe conduct reviewed by an Operator.  ",
        reportId: "report-21",
      }),
    ).toEqual({
      requestId: "send-home-request-21",
      targetNewHireId: "user_target",
      privateReason: "Unsafe conduct reviewed by an Operator.",
      reportId: "report-21",
    });
    expect(
      parseSendHomeRequest({
        requestId: "send-home-request-21",
        targetNewHireId: "user_target",
        privateReason: "   ",
      }),
    ).toBeNull();
  });

  test("recovers after expiry without overriding deletion or Termination", () => {
    const now = new Date("2026-07-23T00:00:00.000Z");
    expect(
      employmentAccessDecision({
        now,
        sentHomeUntil: new Date("2026-07-23T00:00:00.000Z"),
        deletedAt: null,
        terminatedAt: null,
      }),
    ).toEqual({ eligible: true, reason: null, until: null });
    expect(
      employmentAccessDecision({
        now,
        sentHomeUntil: new Date("2026-07-24T00:00:00.000Z"),
        deletedAt: null,
        terminatedAt: new Date("2026-07-22T08:00:00.000Z"),
      }).reason,
    ).toBe("terminated");
    expect(
      employmentAccessDecision({
        now,
        sentHomeUntil: new Date("2026-07-23T00:00:00.000Z"),
        deletedAt: new Date("2026-07-22T08:00:00.000Z"),
        terminatedAt: null,
      }).reason,
    ).toBe("deleted");
  });

  test("accepts only the privacy-safe Send Home System Event envelope", () => {
    const message = {
      id: "send-home-message-21",
      channelId: "all-hands:v3:2026-07-22",
      sender: { id: OFFICE_EVENT_SENDERS.operations, anon: false },
      timestamp: 1_753_219_800_000,
      kind: "text",
      type: EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
      ephemeral: false,
      retracted: false,
      status: "sent",
      content: {
        version: EMPLOYMENT_SYSTEM_EVENT_VERSION,
        type: "employment.sent-home",
        eventKey: "employment-event:v1:2026-07-22:action-21",
        officeDay: "2026-07-22",
        operatorId: "user_operator",
        targetNewHireId: "user_target",
        expiresAt: "2026-07-23T00:00:00.000Z",
        text: SEND_HOME_SYSTEM_EVENT_TEXT,
      },
    };

    expect(
      parsePublicSendHomeSystemEventMessage(message, "all-hands:v3:2026-07-22"),
    ).toMatchObject({
      eventKey: message.content.eventKey,
      operatorId: message.content.operatorId,
      targetNewHireId: message.content.targetNewHireId,
    });
    const versionedMessage = {
      ...message,
      channelId: "all-hands:v3:2026-07-24",
      content: {
        ...message.content,
        eventKey: "employment-event:v1:2026-07-24:action-22",
        officeDay: "2026-07-24",
        expiresAt: "2026-07-25T00:00:00.000Z",
      },
    };
    expect(
      parsePublicSendHomeSystemEventMessage(
        versionedMessage,
        versionedMessage.channelId,
      ),
    ).not.toBeNull();
    expect(
      parsePublicSendHomeSystemEventMessage(
        {
          ...message,
          content: { ...message.content, privateReason: "must stay private" },
        },
        "all-hands:v3:2026-07-22",
      ),
    ).toBeNull();
  });

  test("validates private Termination and reinstatement mutation contracts", () => {
    expect(
      parseTerminationRequest({
        requestId: "terminate-22",
        targetNewHireId: "user_target",
        privateReason: "  Private reason.  ",
        reportId: "report-22",
      }),
    ).toEqual({
      requestId: "terminate-22",
      targetNewHireId: "user_target",
      privateReason: "Private reason.",
      reportId: "report-22",
    });
    expect(
      parseReinstatementRequest({
        requestId: "reinstate-22",
        targetNewHireId: "user_target",
        privateReason: "Resolved privately.",
        reportId: "must-not-be-accepted",
      }),
    ).toBeNull();
  });

  test("accepts privacy-safe Termination events and rejects private fields", () => {
    const base = {
      id: "termination-message-22",
      channelId: "all-hands:v3:2026-07-22",
      sender: { id: OFFICE_EVENT_SENDERS.operations, anon: false },
      timestamp: 1_753_219_800_000,
      kind: "text",
      type: EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
      ephemeral: false,
      retracted: false,
      status: "sent",
    };
    const event = {
      version: EMPLOYMENT_SYSTEM_EVENT_VERSION,
      type: "employment.terminated",
      eventKey:
        "employment-event:v1:2026-07-22:terminated:termination-action-22",
      officeDay: "2026-07-22",
      operatorId: "user_operator",
      targetNewHireId: "user_target",
      terminationId: "termination-action-22",
      text: TERMINATION_SYSTEM_EVENT_TEXT,
    };
    expect(
      parsePublicTerminationSystemEventMessage(
        { ...base, content: event },
        base.channelId,
      ),
    ).toMatchObject({
      action: "terminated",
      terminationId: event.terminationId,
    });
    const versionedBase = {
      ...base,
      channelId: "all-hands:v3:2026-07-24",
    };
    const versionedEvent = {
      ...event,
      eventKey:
        "employment-event:v1:2026-07-24:terminated:termination-action-23",
      officeDay: "2026-07-24",
      terminationId: "termination-action-23",
    };
    expect(
      parsePublicTerminationSystemEventMessage(
        { ...versionedBase, content: versionedEvent },
        versionedBase.channelId,
      ),
    ).not.toBeNull();
    expect(
      parsePublicTerminationSystemEventMessage(
        {
          ...base,
          content: { ...event, privateReason: "must stay private" },
        },
        base.channelId,
      ),
    ).toBeNull();
    expect(REINSTATEMENT_SYSTEM_EVENT_TEXT).not.toContain("reason");
  });
});
