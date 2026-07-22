import { describe, expect, test } from "bun:test";
import {
  createPortalHRReportInvalidationPublisher,
  createPortalHRReportNotificationPublisher,
} from "@/lib/portal/server";

describe("Portal HR Report notification adapter", () => {
  test("uses private targeted sends with only stable review context", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const publisher = createPortalHRReportNotificationPublisher({
      secret: "server-secret",
      apiKey: "publishable-key",
      apiUrl: "https://portal.example.test",
      fetcher: (async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url.endsWith("/v1/tokens")) {
          return Response.json({
            token: "sender-token",
            expiresAt: "2026-07-22T12:15:00.000Z",
          });
        }
        if (url.endsWith("/messages")) {
          return Response.json({ id: "portal-notification", timestamp: 1 });
        }
        return Response.json({ ok: true });
      }) as typeof fetch,
    });

    await publisher.publishHRReportNotification(
      {
        notificationId: "hr-report-notification:report-17",
        type: "hr-report.ready",
        title: "Message HR Report ready for review",
        href: "https://office.example.com/office?officeDay=2026-07-22&channel=general&message=message-17",
        subjectType: "message",
        officeDay: "2026-07-22",
        officeChannelId: "general:2026-07-22",
        messageId: "message-17",
      },
      ["user_operator"],
    );

    const publishRequest = requests.find(({ url }) =>
      url.endsWith("/messages"),
    );
    expect(publishRequest?.body).toEqual({
      senderId: "office-events:operations",
      type: "hr-report.ready",
      to: "user_operator",
      content: {
        title: "Message HR Report ready for review",
        href: "https://office.example.com/office?officeDay=2026-07-22&channel=general&message=message-17",
        subjectType: "message",
        officeDay: "2026-07-22",
        officeChannelId: "general:2026-07-22",
        messageId: "message-17",
      },
    });
    expect(JSON.stringify(publishRequest?.body)).not.toMatch(
      /category|reporter|messageBody|preview/i,
    );
  });

  test("identifies a New Hire Profile report without publishing mutable profile values", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const publisher = createPortalHRReportNotificationPublisher({
      secret: "server-secret",
      apiKey: "publishable-key",
      apiUrl: "https://portal.example.test",
      fetcher: (async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url.endsWith("/v1/tokens")) {
          return Response.json({
            token: "sender-token",
            expiresAt: "2026-07-22T12:15:00.000Z",
          });
        }
        if (url.endsWith("/messages")) {
          return Response.json({ id: "portal-notification", timestamp: 1 });
        }
        return Response.json({ ok: true });
      }) as typeof fetch,
    });

    await publisher.publishHRReportNotification(
      {
        notificationId: "hr-report-notification:profile-report-18",
        type: "hr-report.ready",
        title: "New Hire Profile HR Report ready for review",
        href: "https://office.example.com/office?profile=user_profile_subject",
        subjectType: "profile",
        profileId: "user_profile_subject",
      },
      ["user_operator"],
    );

    const publishRequest = requests.find(({ url }) =>
      url.endsWith("/messages"),
    );
    expect(publishRequest?.body).toEqual({
      senderId: "office-events:operations",
      type: "hr-report.ready",
      to: "user_operator",
      content: {
        title: "New Hire Profile HR Report ready for review",
        href: "https://office.example.com/office?profile=user_profile_subject",
        subjectType: "profile",
        profileId: "user_profile_subject",
      },
    });
    expect(JSON.stringify(publishRequest?.body)).not.toMatch(
      /category|reporter|displayName|imageUrl|firstName|lastName/i,
    );
  });
});

describe("Portal HR Report invalidation adapter", () => {
  test("publishes only the stable report reference from the operations sender", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const publisher = createPortalHRReportInvalidationPublisher({
      secret: "server-secret",
      apiKey: "publishable-key",
      apiUrl: "https://portal.example.test",
      fetcher: (async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url.endsWith("/v1/tokens")) {
          return Response.json({
            token: "operations-token",
            expiresAt: "2026-07-22T12:15:00.000Z",
          });
        }
        if (url.endsWith("/messages")) {
          return Response.json({ id: "portal-event", timestamp: 1 });
        }
        return Response.json({ ok: true });
      }) as typeof fetch,
    });

    await publisher.publishHRReportInvalidation({
      version: 1,
      type: "report.invalidated",
      eventKey: "office-event:v1:report.invalidated:action-19",
      occurredAt: "2026-07-22T12:05:00.000Z",
      reportId: "report-19",
    });

    const membership = requests.find(({ url }) => url.endsWith("/members"));
    expect(membership?.body).toMatchObject({
      userId: "office-events:operations",
    });
    const publication = requests.find(({ url }) => url.endsWith("/messages"));
    expect(publication?.body).toEqual({
      senderId: "office-events:operations",
      type: "office.event",
      content: {
        version: 1,
        type: "report.invalidated",
        eventKey: "office-event:v1:report.invalidated:action-19",
        occurredAt: "2026-07-22T12:05:00.000Z",
        reportId: "report-19",
      },
    });
    expect(JSON.stringify(publication?.body)).not.toMatch(
      /category|reporter|privateNote|messageBody/i,
    );
  });
});
