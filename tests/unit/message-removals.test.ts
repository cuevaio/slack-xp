import { describe, expect, test } from "bun:test";
import {
  parseMessageRemovalChannelQuery,
  parseMessageRemovalRequest,
} from "@/lib/message-removals/domain";

describe("Removed Message input", () => {
  test("accepts only a current Office Channel, stable message ID, and required private reason", () => {
    expect(
      parseMessageRemovalRequest(
        {
          officeChannelId: "general:2026-07-22",
          messageId: "message-20",
          privateReason: "  Contains a direct threat.  ",
        },
        "2026-07-22",
      ),
    ).toEqual({
      officeChannelId: "general:2026-07-22",
      messageId: "message-20",
      privateReason: "Contains a direct threat.",
    });

    expect(
      parseMessageRemovalRequest(
        {
          officeChannelId: "general:2026-07-21",
          messageId: "message-20",
          privateReason: "Wrong Office Day",
        },
        "2026-07-22",
      ),
    ).toBeNull();
    expect(
      parseMessageRemovalRequest(
        {
          officeChannelId: "general:2026-07-22",
          messageId: "message-20",
          privateReason: "   ",
        },
        "2026-07-22",
      ),
    ).toBeNull();
    expect(
      parseMessageRemovalRequest(
        {
          officeChannelId: "general:2026-07-22",
          messageId: "message-20",
          privateReason: "x".repeat(1_001),
        },
        "2026-07-22",
      ),
    ).toBeNull();
  });

  test("validates canonical removal queries against the Office Day", () => {
    expect(
      parseMessageRemovalChannelQuery("tech-support:2026-07-22", "2026-07-22"),
    ).toBe("tech-support:2026-07-22");
    expect(
      parseMessageRemovalChannelQuery("private:2026-07-22", "2026-07-22"),
    ).toBeNull();
    expect(
      parseMessageRemovalChannelQuery("urgent:2026-07-23", "2026-07-23"),
    ).toBe("urgent:2026-07-23");
    expect(
      parseMessageRemovalRequest(
        {
          officeChannelId: "urgent:2026-07-23",
          messageId: "message-legacy-review",
          privateReason: "Reviewed from the preserved rollout channel.",
        },
        "2026-07-23",
      ),
    ).toEqual({
      officeChannelId: "urgent:2026-07-23",
      messageId: "message-legacy-review",
      privateReason: "Reviewed from the preserved rollout channel.",
    });
    expect(
      parseMessageRemovalChannelQuery("urgent:2026-07-24", "2026-07-24"),
    ).toBeNull();
  });
});
