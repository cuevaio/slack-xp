import { describe, expect, test } from "bun:test";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import {
  flushProfileInvalidations,
  projectAndPropagateProfile,
} from "@/lib/profiles/propagation";
import type {
  ProfileInvalidationEvent,
  ProfileInvalidationPublisher,
} from "@/lib/profiles/types";

const originalProfile = {
  clerkUserId: "user_profile_propagation",
  firstName: "Pat",
  lastName: "Pending",
  displayName: "Pat Pending",
  imageUrl: "https://img.example/pat.png",
  sourceVersion: 10,
};

describe("profile projection propagation", () => {
  test("publishes only after canonical state commits and exposes only a stable reference", async () => {
    const repository = createInMemoryNeonRepository(
      () => new Date("2026-07-22T12:00:00.000Z"),
    );
    let observedCanonicalName: string | undefined;
    const published: ProfileInvalidationEvent[] = [];
    const publisher: ProfileInvalidationPublisher = {
      async publishProfileInvalidation(event) {
        observedCanonicalName = (
          await repository.getProfiles([event.profileId])
        )[0]?.displayName;
        published.push(event);
      },
    };

    expect(
      await projectAndPropagateProfile({
        repository,
        publisher,
        profile: originalProfile,
      }),
    ).toBe("applied");

    expect(observedCanonicalName).toBe("Pat Pending");
    expect(published).toHaveLength(1);
    expect(Object.keys(published[0] ?? {}).sort()).toEqual([
      "eventKey",
      "occurredAt",
      "profileId",
      "type",
      "version",
    ]);
    expect(JSON.stringify(published[0])).not.toContain("Pat Pending");
    expect(JSON.stringify(published[0])).not.toContain("img.example");
  });

  test("retries one deterministic outbox event and ignores reordered projection writes", async () => {
    const repository = createInMemoryNeonRepository(
      () => new Date("2026-07-22T12:00:00.000Z"),
    );
    const attemptedKeys: string[] = [];
    let fail = true;
    const publisher: ProfileInvalidationPublisher = {
      async publishProfileInvalidation(event) {
        attemptedKeys.push(event.eventKey);
        if (fail) throw new Error("controlled Portal outage");
      },
    };

    await expect(
      projectAndPropagateProfile({
        repository,
        publisher,
        profile: originalProfile,
      }),
    ).rejects.toThrow("controlled Portal outage");

    fail = false;
    expect(await flushProfileInvalidations(repository, publisher)).toBe(1);
    expect(await flushProfileInvalidations(repository, publisher)).toBe(0);
    expect(attemptedKeys).toEqual([attemptedKeys[0], attemptedKeys[0]]);

    expect(
      await projectAndPropagateProfile({
        repository,
        publisher,
        profile: {
          ...originalProfile,
          displayName: "Stale Name",
          sourceVersion: 9,
        },
      }),
    ).toBe("unchanged");
    expect(attemptedKeys).toHaveLength(2);
    expect(
      (await repository.getProfiles([originalProfile.clerkUserId]))[0]
        ?.displayName,
    ).toBe("Pat Pending");
  });
});
