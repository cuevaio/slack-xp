import { describe, expect, test } from "bun:test";
import {
  connectionStatusCopy,
  currentDetailedNewHireIds,
  currentTypingNewHireIds,
  isReservedPortalIdentity,
} from "@/lib/portal/presence";
import { fetchProfileAttributions } from "@/lib/profiles/client";

describe("Portal presence presentation contract", () => {
  const detailedPresence = {
    kind: "detailed" as const,
    participants: [
      { id: "user_pat", anon: false },
      { id: "office-character:fax-machine", anon: false },
      { id: "office-events:profiles", anon: false },
      { id: "anonymous-observer", anon: true },
      { id: "user_pat", anon: false },
      { id: "user_terry", anon: false },
    ],
    count: 6,
  };

  test("resolves only unique authenticated New Hire identities while connected", () => {
    expect(currentDetailedNewHireIds(detailedPresence, "ready")).toEqual([
      "user_pat",
      "user_terry",
    ]);
    expect(currentDetailedNewHireIds(detailedPresence, "degraded")).toEqual([
      "user_pat",
      "user_terry",
    ]);
  });

  test("hides stale presence and typing during every disconnected state", () => {
    for (const status of [
      "idle",
      "connecting",
      "reconnecting",
      "degraded-http",
      "blocked",
    ] as const) {
      expect(currentDetailedNewHireIds(detailedPresence, status)).toEqual([]);
      expect(
        currentTypingNewHireIds(
          ["user_terry", "office-character:fax-machine"],
          status,
        ),
      ).toEqual([]);
    }
  });

  test("keeps reserved system and Office Character identities out of activity", () => {
    expect(isReservedPortalIdentity("office-character:fax-machine")).toBe(true);
    expect(isReservedPortalIdentity("office-events:operations")).toBe(true);
    expect(isReservedPortalIdentity("user_pat")).toBe(false);
    expect(
      currentTypingNewHireIds(
        [
          "user_terry",
          "user_terry",
          "office-character:fax-machine",
          "office-events:profiles",
        ],
        "ready",
      ),
    ).toEqual(["user_terry"]);
  });

  test("names connecting, connected, reconnecting, and offline states plainly", () => {
    expect(connectionStatusCopy("connecting")).toContain("Connecting");
    expect(connectionStatusCopy("ready")).toContain("Connected");
    expect(connectionStatusCopy("reconnecting")).toContain("Reconnecting");
    expect(connectionStatusCopy("blocked")).toContain("Offline");
  });

  test("loads only the current stable identities through the profile batch boundary", async () => {
    let requestBody: unknown;
    const profiles = await fetchProfileAttributions(
      currentDetailedNewHireIds(detailedPresence, "ready"),
      async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({
          profiles: [
            {
              clerkUserId: "user_pat",
              displayName: "Pat Pending",
              imageUrl: null,
              status: "current",
            },
            {
              clerkUserId: "user_terry",
              displayName: "Terry Byte",
              imageUrl: null,
              status: "current",
            },
            {
              clerkUserId: "office-character:fax-machine",
              displayName: "Fax Machine",
              imageUrl: null,
              status: "current",
            },
          ],
        });
      },
    );

    expect(requestBody).toEqual({
      clerkUserIds: ["user_pat", "user_terry"],
    });
    expect(profiles.map(({ displayName }) => displayName)).toEqual([
      "Pat Pending",
      "Terry Byte",
    ]);
  });
});
