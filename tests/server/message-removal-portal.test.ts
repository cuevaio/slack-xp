import { describe, expect, test } from "bun:test";
import { createPortalMessageRemovalInvalidationPublisher } from "@/lib/portal/server";

describe("Portal Removed Message invalidation adapter", () => {
  test("publishes only a stable message reference from the reserved operations sender", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const publisher = createPortalMessageRemovalInvalidationPublisher({
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

    await publisher.publishMessageRemovalInvalidation({
      version: 1,
      type: "message-removal.invalidated",
      eventKey:
        "office-event:v1:message-removal.invalidated:removal-contract-20",
      occurredAt: "2026-07-22T12:05:00.000Z",
      messageId: "message-20",
    });

    expect(
      requests.find(({ url }) => url.endsWith("/members"))?.body,
    ).toMatchObject({ userId: "office-events:operations" });
    const publication = requests.find(({ url }) => url.endsWith("/messages"));
    expect(publication?.body).toEqual({
      type: "office.event",
      content: {
        version: 1,
        type: "message-removal.invalidated",
        eventKey:
          "office-event:v1:message-removal.invalidated:removal-contract-20",
        occurredAt: "2026-07-22T12:05:00.000Z",
        messageId: "message-20",
      },
    });
    expect(JSON.stringify(publication?.body)).not.toMatch(
      /reason|operator|messageBody|payload|content.*text/i,
    );
  });
});
