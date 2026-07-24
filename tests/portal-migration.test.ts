import { describe, expect, test } from "bun:test";
import {
  createMigrationPublishBody,
  type MigrationHistoryMessage,
  planAnnouncementMigration,
  preflightAnnouncementMigration,
  resolveAnnouncementMembers,
} from "../src/lib/portal/announcement-migration";
import { REACTION_EVENT_TYPE } from "../src/lib/portal/reactions";

function historyMessage(
  id: string,
  content: Record<string, unknown>,
  type = "message",
  seq = 1,
): MigrationHistoryMessage {
  return {
    id,
    seq,
    type,
    kind: "text",
    content,
    sender: { id: "user_1", anon: false },
    timestamp: 1_000 + seq,
    retracted: false,
    ephemeral: false,
  };
}

describe("Announcements migration planning", () => {
  test("resolves broadcast senders from the standard Office Channel directory", () => {
    const source = historyMessage("message_1", { text: "hello" });
    source.sender.id = "user_1";
    const result = resolveAnnouncementMembers(
      [source],
      [
        {
          userId: "user_1",
          online: false,
          claims: {
            username: "Ada",
            avatar: "https://images.example/ada.png",
          },
        },
      ],
    );

    expect(result.members).toEqual([
      {
        userId: "user_1",
        claims: {
          username: "Ada",
          avatar: "https://images.example/ada.png",
        },
      },
    ]);
    expect(result.unresolvedUserIds).toEqual([]);
  });

  test("does not install a sender ID as its display name", () => {
    const source = historyMessage("message_1", { text: "hello" });
    source.sender.username = source.sender.id;

    expect(resolveAnnouncementMembers([source], [])).toEqual({
      members: [],
      unresolvedUserIds: ["user_1"],
    });
  });

  test("detects metadata-induced overflow before migration", () => {
    const source = historyMessage("message_1", { text: "x".repeat(2_000) });
    const result = preflightAnnouncementMigration([source]);
    expect(result.blockers).toEqual([
      expect.stringContaining("message_1 exceeds Portal's 2 KB content limit"),
    ]);
  });

  test("omits and reports reactions whose source target is absent", () => {
    const orphan = historyMessage(
      "reaction_1",
      {
        targetMessageId: "missing",
        reaction: "like",
        mutationId: "mutation_1",
      },
      REACTION_EVENT_TYPE,
      2,
    );
    const result = preflightAnnouncementMigration([orphan]);
    expect(result.blockers).toEqual([]);
    expect(result.orphanReactionIds).toEqual(["reaction_1"]);
    expect(result.migratableIds).toEqual([]);
  });

  test("remaps valid reactions and never publishes historical mentions", () => {
    const reaction = historyMessage(
      "reaction_1",
      {
        targetMessageId: "message_1",
        reaction: "like",
        mutationId: "mutation_1",
      },
      REACTION_EVENT_TYPE,
      2,
    );
    const body = createMigrationPublishBody(
      reaction,
      new Map([["message_1", "new_message_1"]]),
    );
    expect(body.content).toEqual(
      expect.objectContaining({ targetMessageId: "new_message_1" }),
    );
    expect("mentions" in body).toBe(false);
  });

  test("a rerun skips records already copied without duplication", () => {
    const source = [
      historyMessage("message_1", { text: "first" }, "message", 1),
      historyMessage("message_2", { text: "second" }, "message", 2),
    ];
    const target = [
      historyMessage("new_message_1", {
        text: "first",
        portalMigration: {
          sourceMessageId: "message_1",
          originalTimestamp: 1_001,
        },
      }),
    ];
    const plan = planAnnouncementMigration(source, target);
    expect(plan.skipped).toBe(1);
    expect(plan.pending.map(({ id }) => id)).toEqual(["message_2"]);
  });
});
