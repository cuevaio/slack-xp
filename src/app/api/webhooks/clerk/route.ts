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
    if (event.type === "user.created" || event.type === "user.updated") {
      const profile = profileFromClerkPayload(event.data);
      if (dependencies.publisher) {
        await projectAndPropagateProfile({
          repository: dependencies.repository,
          publisher: dependencies.publisher,
          profile,
          options: {
            allowTombstoneRestore: event.type === "user.created",
          },
        });
      } else {
        await dependencies.repository.projectProfile(profile, {
          allowTombstoneRestore: event.type === "user.created",
        });
      }
    } else if (event.type === "user.deleted") {
      const tombstone = deletedProfileFromClerkPayload(
        event.data,
        request.headers.get("svix-timestamp"),
      );
      const publisher = dependencies.publisher;
      const accessRevoker = dependencies.accessRevoker;
      if (publisher && accessRevoker) {
        await deleteClerkProfile({
          repository: dependencies.repository,
          portal: {
            publishProfileInvalidation: (event) =>
              publisher.publishProfileInvalidation(event),
            applyTerminationBans: (input) =>
              accessRevoker.applyTerminationBans(input),
          },
          tombstone,
          now: dependencies.now,
        });
      } else {
        await dependencies.repository.tombstoneProfile(tombstone);
        if (dependencies.publisher) {
          await flushProfileInvalidations(
            dependencies.repository,
            dependencies.publisher,
          );
        }
      }
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
