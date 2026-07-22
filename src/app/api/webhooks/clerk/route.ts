import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { readAppConfiguration } from "@/lib/config";
import { createDatabase } from "@/lib/db/client";
import { createNeonOnboardingRepository } from "@/lib/onboarding/neon";
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
  request: Request,
  dependencies: ClerkWebhookDependencies,
): Promise<Response> {
  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    // Clerk's Next.js type currently narrows this Web Request to NextRequest,
    // although verification only consumes headers and text(). Route Handlers
    // and deterministic boundary tests both provide that complete contract.
    event = await verifyWebhook(
      request as unknown as Parameters<typeof verifyWebhook>[0],
      {
        signingSecret: dependencies.signingSecret,
      },
    );
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

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (
    configuration.status === "incomplete" ||
    configuration.serviceMode !== "live"
  ) {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }

  const repository = createNeonOnboardingRepository(
    createDatabase(configuration.values.DATABASE_URL),
  );
  return handleClerkProfileWebhook(request, {
    repository,
    signingSecret: configuration.values.CLERK_WEBHOOK_SECRET,
  });
}
