import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { handleProfileBatchRequest } from "@/app/api/office/profiles/route";
import { handleClerkProfileWebhook } from "@/app/api/webhooks/clerk/route";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import { createMockPortalAdapter } from "@/lib/portal/mock";
import {
  readProfileBatch,
  repairProfileProjection,
} from "@/lib/profiles/service";

const SIGNING_SECRET = `whsec_${Buffer.from(
  "portal-messenger-profile-webhook-test-key",
).toString("base64")}`;

function clerkEvent(
  sourceVersion: number,
  overrides: Partial<{
    type: "user.created" | "user.updated";
    id: string;
    first_name: string | null;
    last_name: string | null;
    image_url: string;
  }> = {},
) {
  const { type = "user.updated", ...dataOverrides } = overrides;
  return {
    type,
    data: {
      id: "user_profile_projection",
      first_name: "Pat",
      last_name: "Pending",
      image_url: "https://img.example/pat.png",
      updated_at: sourceVersion,
      ...dataOverrides,
    },
    event_attributes: {
      http_request: { client_ip: "127.0.0.1", user_agent: "test" },
    },
  };
}

function clerkDeletionEvent(id = "user_profile_projection") {
  return {
    type: "user.deleted" as const,
    data: {
      id,
      object: "user",
      deleted: true,
    },
    event_attributes: {
      http_request: { client_ip: "127.0.0.1", user_agent: "test" },
    },
  };
}

function signedWebhookRequest(
  event: ReturnType<typeof clerkEvent> | ReturnType<typeof clerkDeletionEvent>,
  signingSecret = SIGNING_SECRET,
  timestampSeconds = Math.floor(Date.now() / 1000),
): NextRequest {
  const body = JSON.stringify(event);
  const messageId = `msg_${event.type}_${timestampSeconds}`;
  const timestamp = timestampSeconds.toString();
  const secret = Buffer.from(signingSecret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", secret)
    .update(`${messageId}.${timestamp}.${body}`)
    .digest("base64");

  return new NextRequest("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": messageId,
      "svix-signature": `v1,${signature}`,
      "svix-timestamp": timestamp,
    },
    body,
  });
}

describe("Clerk profile webhook boundary", () => {
  test("rejects an invalid signature before changing the projection", async () => {
    const repository = createInMemoryNeonRepository();
    const request = signedWebhookRequest(
      clerkDeletionEvent(),
      `whsec_${Buffer.from("wrong-signing-key").toString("base64")}`,
    );

    const response = await handleClerkProfileWebhook(request, {
      repository,
      signingSecret: SIGNING_SECRET,
    });

    expect(response.status).toBe(400);
    expect(await repository.getProfiles(["user_profile_projection"])).toEqual([
      {
        clerkUserId: "user_profile_projection",
        displayName: "New Hire",
        imageUrl: null,
        status: "unavailable",
      },
    ]);
  });

  test("accepts valid create/update payloads and ignores replayed or older state", async () => {
    const repository = createInMemoryNeonRepository();

    for (const event of [
      clerkEvent(20, { type: "user.created", first_name: "Patricia" }),
      clerkEvent(20, { first_name: "Patricia" }),
      clerkEvent(10, { first_name: "Stale" }),
    ]) {
      const response = await handleClerkProfileWebhook(
        signedWebhookRequest(event),
        { repository, signingSecret: SIGNING_SECRET },
      );
      expect(response.status).toBe(204);
    }

    expect(
      await readProfileBatch(repository, ["user_profile_projection"]),
    ).toEqual([
      {
        clerkUserId: "user_profile_projection",
        displayName: "Patricia Pending",
        imageUrl: "https://img.example/pat.png",
        status: "current",
      },
    ]);
    expect(repository.projectionWriteCount()).toBe(1);
  });

  test("rejects a signed but malformed profile payload safely", async () => {
    const repository = createInMemoryNeonRepository();
    const event = clerkEvent(Number.NaN);

    const response = await handleClerkProfileWebhook(
      signedWebhookRequest(event),
      { repository, signingSecret: SIGNING_SECRET },
    );

    expect(response.status).toBe(400);
    expect(repository.projectionWriteCount()).toBe(0);
  });

  test("tombstones verified deletion once and rejects delayed updates", async () => {
    const signedTimestamp = Math.floor(Date.now() / 1_000);
    const deletionSourceVersion = signedTimestamp * 1_000 + 999;
    const now = new Date("2026-07-23T12:00:00.000Z");
    const repository = createInMemoryNeonRepository(() => now);
    const portal = createMockPortalAdapter({ now: () => now });
    const dependencies = {
      repository,
      publisher: portal,
      accessRevoker: portal,
      signingSecret: SIGNING_SECRET,
      now,
    };
    await repository.projectProfile({
      clerkUserId: "user_profile_projection",
      firstName: "Private",
      lastName: "Person",
      displayName: "Private Person",
      imageUrl: "https://img.example/private.png",
      sourceVersion: deletionSourceVersion - 1_000,
    });
    const deletion = clerkDeletionEvent();

    for (const event of [deletion, deletion]) {
      const response = await handleClerkProfileWebhook(
        signedWebhookRequest(event, SIGNING_SECRET, signedTimestamp),
        dependencies,
      );
      expect(response.status).toBe(204);
    }
    await handleClerkProfileWebhook(
      signedWebhookRequest(
        clerkEvent(deletionSourceVersion - 1, {
          first_name: "Delayed",
          last_name: "Update",
          image_url: "https://img.example/delayed.png",
        }),
        SIGNING_SECRET,
        signedTimestamp,
      ),
      dependencies,
    );

    expect(await repository.getProfiles(["user_profile_projection"])).toEqual([
      {
        clerkUserId: "user_profile_projection",
        displayName: "Former Employee",
        imageUrl: null,
        status: "former",
      },
    ]);
    expect(repository.projectionWriteCount()).toBe(2);
    expect(portal.activeBans("user_profile_projection")).toHaveLength(6);
  });

  test("keeps deletion ahead of concurrent session repair until a newer creation lifecycle", async () => {
    const signedTimestamp = Math.floor(Date.now() / 1_000);
    const deletionSourceVersion = signedTimestamp * 1_000 + 999;
    const repository = createInMemoryNeonRepository();
    const identity = {
      id: "user_profile_projection",
      sessionId: "session_being_removed",
      firstName: "Private",
      lastName: "Person",
      fullName: "Private Person",
      imageUrl: "https://img.example/private.png",
      sourceVersion: deletionSourceVersion - 1_000,
      isOperator: false,
      authentication: "clerk" as const,
    };
    await repairProfileProjection(repository, identity);

    await Promise.all([
      handleClerkProfileWebhook(
        signedWebhookRequest(
          clerkDeletionEvent(),
          SIGNING_SECRET,
          signedTimestamp,
        ),
        { repository, signingSecret: SIGNING_SECRET },
      ),
      repairProfileProjection(repository, identity),
    ]);
    expect((await repository.getProfiles([identity.id]))[0]?.status).toBe(
      "former",
    );

    await handleClerkProfileWebhook(
      signedWebhookRequest(
        clerkEvent(deletionSourceVersion + 1_000, {
          type: "user.created",
          first_name: "Valid",
          last_name: "Lifecycle",
          image_url: "",
        }),
        SIGNING_SECRET,
        signedTimestamp,
      ),
      { repository, signingSecret: SIGNING_SECRET },
    );
    expect(await repository.getProfiles([identity.id])).toEqual([
      {
        clerkUserId: identity.id,
        displayName: "Valid Lifecycle",
        imageUrl: null,
        status: "current",
      },
    ]);
  });
});

describe("New Hire Profile convergence", () => {
  test("times out closed with correlation-safe Neon logging", async () => {
    const repository = createInMemoryNeonRepository();
    const logs: unknown[] = [];
    repository.getProfiles = async () => new Promise(() => {});
    const response = await handleProfileBatchRequest(
      new Request("http://localhost/api/office/profiles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "profile-safety-test",
        },
        body: JSON.stringify({
          clerkUserIds: ["user_profile_projection"],
          messageBody: "must never enter logs",
        }),
      }),
      repository,
      { timeoutMs: 1, logger: (entry) => logs.push(entry) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "safety_projection_unavailable",
      correlationId: "profile-safety-test",
    });
    expect(logs).toEqual([
      {
        operation: "profile_batch",
        correlationId: "profile-safety-test",
        authority: "neon",
        status: "unavailable",
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain("must never enter logs");
  });

  test("repairs missing or drifted session state without letting stale repair win", async () => {
    const repository = createInMemoryNeonRepository();
    const currentIdentity = {
      id: "user_session_repair",
      sessionId: "session_repair",
      firstName: "Current",
      lastName: "Name",
      fullName: "Current Name",
      imageUrl: null,
      sourceVersion: 30,
      isOperator: false,
      authentication: "clerk" as const,
    };

    await repairProfileProjection(repository, currentIdentity);
    await Promise.all([
      repository.projectProfile({
        clerkUserId: currentIdentity.id,
        firstName: "Webhook",
        lastName: "Winner",
        displayName: "Webhook Winner",
        imageUrl: "https://img.example/newer.png",
        sourceVersion: 40,
      }),
      repairProfileProjection(repository, currentIdentity),
    ]);

    expect(await readProfileBatch(repository, [currentIdentity.id])).toEqual([
      {
        clerkUserId: currentIdentity.id,
        displayName: "Webhook Winner",
        imageUrl: "https://img.example/newer.png",
        status: "current",
      },
    ]);
  });

  test("batches unique stable IDs and resolves historical attribution to current state", async () => {
    const repository = createInMemoryNeonRepository();
    const original = {
      clerkUserId: "user_historical_author",
      firstName: "Original",
      lastName: "Name",
      displayName: "Original Name",
      imageUrl: null,
      sourceVersion: 1,
    };
    await repository.projectProfile(original);

    await repository.projectProfile({
      ...original,
      firstName: "Current",
      displayName: "Current Name",
      sourceVersion: 2,
    });

    expect(
      await readProfileBatch(repository, [
        original.clerkUserId,
        "user_missing_projection",
        original.clerkUserId,
      ]),
    ).toEqual([
      {
        clerkUserId: original.clerkUserId,
        displayName: "Current Name",
        imageUrl: null,
        status: "current",
      },
      {
        clerkUserId: "user_missing_projection",
        displayName: "New Hire",
        imageUrl: null,
        status: "unavailable",
      },
    ]);
    expect(repository.profileBatchReadCount()).toBe(1);
  });

  test("validates the bounded batch contract at the server boundary", async () => {
    const repository = createInMemoryNeonRepository();
    const malformed = await handleProfileBatchRequest(
      new Request("http://localhost/api/office/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clerkUserIds: "user_not_an_array" }),
      }),
      repository,
    );

    expect(malformed.status).toBe(400);
    expect(repository.profileBatchReadCount()).toBe(0);
  });
});
