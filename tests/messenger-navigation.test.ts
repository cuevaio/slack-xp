import { describe, expect, test } from "bun:test";
import { messengerMessageTargetFromUrl } from "../src/lib/messenger-navigation";

describe("Messenger message links", () => {
  test("reads an exact channel and message target", () => {
    expect(
      messengerMessageTargetFromUrl(
        "https://messenger.example/?channel=announcements-v2&message=message_42",
      ),
    ).toEqual({
      channelId: "announcements-v2",
      messageId: "message_42",
    });
  });

  test("rejects incomplete and oversized targets", () => {
    expect(
      messengerMessageTargetFromUrl(
        "https://messenger.example/?channel=general",
      ),
    ).toBeNull();
    expect(
      messengerMessageTargetFromUrl(
        `https://messenger.example/?channel=general&message=${"m".repeat(201)}`,
      ),
    ).toBeNull();
  });
});
