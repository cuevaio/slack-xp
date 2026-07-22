import { describe, expect, test } from "bun:test";
import { handleEmployeeRecordUpdate } from "@/app/api/office/employee-record/route";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import type { NewHireProfile } from "@/lib/onboarding/types";
import {
  ProfileUpdateError,
  repairEmployeeRecordProjection,
  updateEmployeeRecord,
} from "@/lib/profiles/edit";

const originalProfile: NewHireProfile = {
  clerkUserId: "user_employee_record",
  firstName: "Pat",
  lastName: "Pending",
  displayName: "Pat Pending",
  imageUrl: null,
  sourceVersion: 1,
};

const editedProfile: NewHireProfile = {
  ...originalProfile,
  firstName: "Patricia",
  displayName: "Patricia Pending",
  imageUrl: "https://img.example/patricia.png",
  sourceVersion: 2,
};

const mockConfiguration: ReadyAppConfiguration = {
  status: "ready",
  environment: "test",
  serviceMode: "mock",
  values: {},
};

const identity: AuthenticatedNewHire = {
  id: originalProfile.clerkUserId,
  sessionId: "session_employee_record",
  firstName: originalProfile.firstName,
  lastName: originalProfile.lastName,
  fullName: originalProfile.displayName,
  imageUrl: originalProfile.imageUrl,
  sourceVersion: originalProfile.sourceVersion,
  isOperator: false,
  authentication: "mock",
};

function updateRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return new Request("http://localhost/api/office/employee-record", {
    method: "POST",
    body: formData,
  });
}

describe("Employee Record update service", () => {
  test("confirms Clerk first and reports that Neon is still converging", async () => {
    const repository = createInMemoryNeonRepository();
    await repository.enterNewHire(originalProfile);
    const order: string[] = [];

    const result = await updateEmployeeRecord({
      repository,
      updateAuthority: async () => {
        order.push("clerk");
        return editedProfile;
      },
      onAuthorityConfirmed: async (clerkUserId) => {
        order.push("onboarding");
        return repository.confirmProfile(clerkUserId);
      },
    });

    expect(order).toEqual(["clerk", "onboarding"]);
    expect(result.convergence).toBe("awaiting_projection");
    expect(result.record.displayName).toBe("Patricia Pending");
    expect(result.onboarding?.step).toBe("conduct");
    expect(await repository.getProfiles([originalProfile.clerkUserId])).toEqual(
      [
        {
          clerkUserId: originalProfile.clerkUserId,
          displayName: "Pat Pending",
          imageUrl: null,
          status: "current",
        },
      ],
    );
  });

  test("does not confirm onboarding when Clerk rejects the edit", async () => {
    const repository = createInMemoryNeonRepository();
    await repository.enterNewHire(originalProfile);

    await expect(
      updateEmployeeRecord({
        repository,
        updateAuthority: async () => {
          throw new ProfileUpdateError(
            "profile_rejected",
            "Clerk did not accept those profile changes.",
          );
        },
        onAuthorityConfirmed: (clerkUserId) =>
          repository.confirmProfile(clerkUserId),
      }),
    ).rejects.toMatchObject({ code: "profile_rejected" });

    expect(
      (await repository.getNewHire(originalProfile.clerkUserId))?.step,
    ).toBe("profile");
  });

  test("repairs delayed projection and updates stable historical attribution", async () => {
    const repository = createInMemoryNeonRepository();
    await repository.enterNewHire(originalProfile);

    const result = await repairEmployeeRecordProjection(
      repository,
      editedProfile,
    );

    expect(result.convergence).toBe("projected");
    expect(await repository.getProfiles([originalProfile.clerkUserId])).toEqual(
      [
        {
          clerkUserId: originalProfile.clerkUserId,
          displayName: "Patricia Pending",
          imageUrl: "https://img.example/patricia.png",
          status: "current",
        },
      ],
    );
  });

  test("times out without claiming that Clerk rejected or completed the edit", async () => {
    const repository = createInMemoryNeonRepository();
    await repository.enterNewHire(originalProfile);

    await expect(
      updateEmployeeRecord({
        repository,
        updateAuthority: () => new Promise(() => undefined),
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "profile_update_timed_out" });
  });
});

describe("Employee Record server boundary", () => {
  test("returns accessible field errors without calling Clerk", async () => {
    const repository = createInMemoryNeonRepository();
    let authorityCalls = 0;
    const response = await handleEmployeeRecordUpdate(
      updateRequest({ firstName: "", lastName: "Pending" }),
      {
        configuration: mockConfiguration,
        identity,
        repository,
        updateAuthority: async () => {
          authorityCalls += 1;
          return editedProfile;
        },
      },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "invalid_profile",
      fieldErrors: {
        firstName: "Please enter a first name before continuing.",
      },
    });
    expect(authorityCalls).toBe(0);
  });

  test("maps Clerk rejection to a recoverable response without service details", async () => {
    const repository = createInMemoryNeonRepository();
    const response = await handleEmployeeRecordUpdate(
      updateRequest({ firstName: "Patricia", lastName: "Pending" }),
      {
        configuration: mockConfiguration,
        identity,
        repository,
        updateAuthority: async () => {
          throw new ProfileUpdateError(
            "profile_rejected",
            "Clerk did not accept those profile changes. Review the fields and retry.",
          );
        },
      },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "profile_rejected",
      message:
        "Clerk did not accept those profile changes. Review the fields and retry.",
    });
  });
});
