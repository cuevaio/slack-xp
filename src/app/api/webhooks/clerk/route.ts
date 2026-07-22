import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";
import {
  InvalidClerkProfilePayloadError,
  profileFromClerkPayload,
} from "@/lib/profiles/domain";
import type { ProfileRepository } from "@/lib/profiles/types";

export const runtime = "nodejs";

type ClerkWebhookDependencies = {
  repository: ProfileRepository;
  signingSecret: string;
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

  if (event.type === "user.created" || event.type === "user.updated") {
    try {
      await dependencies.repository.projectProfile(
        profileFromClerkPayload(event.data),
      );
    } catch (error) {
      if (error instanceof InvalidClerkProfilePayloadError) {
        return Response.json({ error: "invalid_webhook" }, { status: 400 });
      }
      throw error;
    }
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

  return handleClerkProfileWebhook(request, {
    repository: createServiceAdapters(configuration).neon,
    signingSecret: configuration.values.CLERK_WEBHOOK_SECRET,
  });
}
