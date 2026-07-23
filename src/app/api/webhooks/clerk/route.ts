import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";
import {
  deleteClerkProfile,
  type ProfileDeletionPortal,
} from "@/lib/profiles/deletion";
import {
  deletedProfileFromClerkPayload,
  InvalidClerkProfilePayloadError,
  profileFromClerkPayload,
} from "@/lib/profiles/domain";
import {
  flushProfileInvalidations,
  projectAndPropagateProfile,
} from "@/lib/profiles/propagation";
import type {
  ProfileInvalidationPublisher,
  ProfileRepository,
} from "@/lib/profiles/types";

export const runtime = "nodejs";

type ClerkWebhookDependencies = {
  repository: ProfileRepository;
  publisher?: ProfileInvalidationPublisher;
  accessRevoker?: Pick<ProfileDeletionPortal, "applyTerminationBans">;
  signingSecret: string;
  now?: Date;
};

type ClerkProfileUpsertEvent = "user.created" | "user.updated";

async function applyClerkProfileUpsert(
  eventType: ClerkProfileUpsertEvent,
  payload: unknown,
  dependencies: ClerkWebhookDependencies,
): Promise<void> {
  const profile = profileFromClerkPayload(payload);
  const options = {
    allowTombstoneRestore: eventType === "user.created",
  };

  if (!dependencies.publisher) {
    await dependencies.repository.projectProfile(profile, options);
    return;
  }

  await projectAndPropagateProfile({
    repository: dependencies.repository,
    publisher: dependencies.publisher,
    profile,
    options,
  });
}

async function applyClerkProfileDeletion(
  payload: unknown,
  signedTimestamp: string | null,
  dependencies: ClerkWebhookDependencies,
): Promise<void> {
  const tombstone = deletedProfileFromClerkPayload(payload, signedTimestamp);
  const { accessRevoker, publisher, repository } = dependencies;

  if (!publisher || !accessRevoker) {
    await repository.tombstoneProfile(tombstone);
    if (publisher) {
      await flushProfileInvalidations(repository, publisher);
    }
    return;
  }

  await deleteClerkProfile({
    repository,
    portal: {
      publishProfileInvalidation: (event) =>
        publisher.publishProfileInvalidation(event),
      applyTerminationBans: (input) =>
        accessRevoker.applyTerminationBans(input),
    },
    tombstone,
    now: dependencies.now,
  });
}

export async function handleClerkProfileWebhook(
  request: NextRequest,
  dependencies: ClerkWebhookDependencies,
): Promise<Response> {
  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, {
      signingSecret: dependencies.signingSecret,
    });
  } catch {
    // Do not log the request, signature, secret, or profile payload.
    return Response.json({ error: "invalid_webhook" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "user.created":
      case "user.updated":
        await applyClerkProfileUpsert(event.type, event.data, dependencies);
        break;
      case "user.deleted":
        await applyClerkProfileDeletion(
          event.data,
          request.headers.get("svix-timestamp"),
          dependencies,
        );
        break;
    }
  } catch (error) {
    if (error instanceof InvalidClerkProfilePayloadError) {
      return Response.json({ error: "invalid_webhook" }, { status: 400 });
    }
    throw error;
  }

  return new Response(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const configuration = readAppConfiguration();
  if (
    configuration.status === "incomplete" ||
    configuration.serviceMode !== "live"
  ) {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }

  const adapters = createServiceAdapters(configuration);
  return handleClerkProfileWebhook(request, {
    repository: adapters.neon,
    publisher: adapters.portal,
    accessRevoker: adapters.portal,
    signingSecret: configuration.values.CLERK_WEBHOOK_SECRET,
  });
}
