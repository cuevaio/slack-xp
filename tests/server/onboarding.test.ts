import { describe, expect, test } from "bun:test";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";

const profile = {
  clerkUserId: "user_first_entry",
  firstName: "Pat",
  lastName: "Pending",
  displayName: "Pat Pending",
  imageUrl: null,
  sourceVersion: 1,
};

describe("onboarding persistence boundary", () => {
  test("creates one stable assignment across concurrent first entry", async () => {
    const repository = createInMemoryNeonRepository();

    const entries = await Promise.all(
      Array.from({ length: 8 }, () => repository.enterNewHire(profile)),
    );

    expect(new Set(entries.map((entry) => entry.jobTitle)).size).toBe(1);
    expect(repository.recordCount()).toBe(1);
    expect(entries.every((entry) => entry.step === "profile")).toBe(true);
  });

  test("resumes interrupted setup and completes Clock In exactly once", async () => {
    const repository = createInMemoryNeonRepository();
    await repository.enterNewHire(profile);

    await repository.confirmProfile(profile.clerkUserId);
    expect((await repository.enterNewHire(profile)).step).toBe("conduct");

    await repository.acceptConduct(profile.clerkUserId);
    expect((await repository.enterNewHire(profile)).step).toBe("clock-in");

    const [completed, retried] = await Promise.all([
      repository.clockIn(profile.clerkUserId),
      repository.clockIn(profile.clerkUserId),
    ]);

    expect(completed.step).toBe("complete");
    expect(retried.completedAt).toBe(completed.completedAt);
    expect((await repository.enterNewHire(profile)).step).toBe("complete");
  });

  test("rejects Clock In until profile and conduct requirements are met", async () => {
    const repository = createInMemoryNeonRepository();
    await repository.enterNewHire(profile);

    await expect(repository.clockIn(profile.clerkUserId)).rejects.toMatchObject(
      {
        code: "onboarding_incomplete",
      },
    );
  });
});
