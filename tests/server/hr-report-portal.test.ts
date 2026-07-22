import { describe, expect, test } from "bun:test";
import { createPortalHRReportNotificationPublisher } from "@/lib/portal/server";

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
        title: "HR Report ready for review",
        href: "https://office.example.com/office?officeDay=2026-07-22&channel=general&message=message-17",
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
      type: "hr-report.ready",
      to: "user_operator",
      content: {
        title: "HR Report ready for review",
        href: "https://office.example.com/office?officeDay=2026-07-22&channel=general&message=message-17",
        officeDay: "2026-07-22",
        officeChannelId: "general:2026-07-22",
        messageId: "message-17",
      },
    });
    expect(JSON.stringify(publishRequest?.body)).not.toMatch(
      /category|reporter|messageBody|preview/i,
    );
  });
});
