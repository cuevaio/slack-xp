import { describe, expect, test } from "bun:test";
import { createMockPortalAdapter } from "../support/portal";

const CHANNEL_ID = "general:2026-07-22";
const ALL_HANDS_ID = "all-hands:2026-07-22";

async function addMember(
  portal: ReturnType<typeof createMockPortalAdapter>,
  channelId: string,
  userId: string,
  username: string,
) {
  await portal.ensureMembership({
    channelId,
    userId,
    claims: { username, avatar: null },
  });
}

describe("controlled multi-client Portal presence", () => {
  test("tracks standard joins, leaves, reconnects, and stable profile identities", async () => {
    const portal = createMockPortalAdapter();
    await addMember(portal, CHANNEL_ID, "user_pat", "Pat Pending");
    await addMember(portal, CHANNEL_ID, "user_terry", "Terry Byte");

    const pat = portal.connect({
      clientId: "pat-tab",
      channelId: CHANNEL_ID,
      userId: "user_pat",
      mode: "standard",
    });
    const terry = portal.connect({
      clientId: "terry-tab",
      channelId: CHANNEL_ID,
      userId: "user_terry",
      mode: "standard",
    });

    expect(pat.presence()).toEqual({
      kind: "detailed",
      participants: [
        {
          id: "user_pat",
          anon: false,
          username: "Pat Pending",
          metadata: undefined,
        },
        {
          id: "user_terry",
          anon: false,
          username: "Terry Byte",
          metadata: undefined,
        },
      ],
      count: 2,
    });

    terry.disconnect();
    expect(pat.presence()).toMatchObject({ count: 1 });
    terry.reconnect();
    expect(pat.presence()).toMatchObject({ count: 2 });
  });

  test("returns aggregate all-hands presence without a participant roster", async () => {
    const portal = createMockPortalAdapter();
    await addMember(portal, ALL_HANDS_ID, "user_pat", "Pat Pending");
    await addMember(portal, ALL_HANDS_ID, "user_terry", "Terry Byte");
    const pat = portal.connect({
      clientId: "pat-broadcast-tab",
      channelId: ALL_HANDS_ID,
      userId: "user_pat",
      mode: "broadcast",
    });
    portal.connect({
      clientId: "terry-broadcast-tab",
      channelId: ALL_HANDS_ID,
      userId: "user_terry",
      mode: "broadcast",
    });

    expect(pat.presence()).toMatchObject({ kind: "aggregate", count: 2 });
    expect(pat.presence()).not.toHaveProperty("participants");
  });

  test("throttles typing, expires inactivity, and clears it on disconnect", async () => {
    let now = 1_753_184_800_000;
    const portal = createMockPortalAdapter({ now: () => new Date(now) });
    await addMember(portal, CHANNEL_ID, "user_pat", "Pat Pending");
    await addMember(portal, CHANNEL_ID, "user_terry", "Terry Byte");
    const pat = portal.connect({
      clientId: "pat-typing-tab",
      channelId: CHANNEL_ID,
      userId: "user_pat",
      mode: "standard",
    });
    const terry = portal.connect({
      clientId: "terry-typing-tab",
      channelId: CHANNEL_ID,
      userId: "user_terry",
      mode: "standard",
    });

    terry.sendTyping();
    now += 1_000;
    terry.sendTyping();
    expect(pat.typing()).toEqual(["user_terry"]);

    now += 4_001;
    expect(pat.typing()).toEqual([]);

    terry.sendTyping();
    expect(pat.typing()).toEqual(["user_terry"]);
    terry.disconnect();
    expect(pat.typing()).toEqual([]);
  });

  test("hides snapshots during outages and rejects Office Character activity", async () => {
    const portal = createMockPortalAdapter();
    await addMember(portal, CHANNEL_ID, "user_pat", "Pat Pending");
    await addMember(
      portal,
      CHANNEL_ID,
      "office-character:fax-machine",
      "Fax Machine",
    );
    const pat = portal.connect({
      clientId: "pat-reconnect-tab",
      channelId: CHANNEL_ID,
      userId: "user_pat",
      mode: "standard",
    });

    expect(() =>
      portal.connect({
        clientId: "character-tab",
        channelId: CHANNEL_ID,
        userId: "office-character:fax-machine",
        mode: "standard",
      }),
    ).toThrow("Office Characters");

    portal.setOnline(false);
    expect(pat.status()).toBe("reconnecting");
    expect(pat.presence()).toBeUndefined();
    expect(pat.typing()).toEqual([]);

    portal.setOnline(true);
    pat.reconnect();
    expect(pat.status()).toBe("ready");
    expect(pat.presence()).toMatchObject({ count: 1 });
  });
});
