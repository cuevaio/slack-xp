import { createMockAdapters } from "@/lib/adapters/mock";
import {
  isMockAuthenticationAllowed,
  MOCK_AUTH_IDENTITIES,
} from "@/lib/auth/mock-session";
import { readAppConfiguration } from "@/lib/config";
import {
  delayNextMockProfileProjection,
  failNextMockProfileUpdate,
} from "@/lib/onboarding/profile-authority";
import { deleteClerkProfile } from "@/lib/profiles/deletion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (
    !isMockAuthenticationAllowed(configuration) ||
    configuration.environment !== "test"
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const formData = await request.formData();
  switch (formData.get("intent")) {
    case "reject-next-update":
      failNextMockProfileUpdate("reject");
      break;
    case "partially-update-next":
      failNextMockProfileUpdate("partial");
      break;
    case "delay-next-projection":
      delayNextMockProfileProjection(2);
      break;
    case "delete-account": {
      const clerkUserId = formData.get("clerkUserId");
      if (
        typeof clerkUserId !== "string" ||
        !Object.values(MOCK_AUTH_IDENTITIES).some(
          (identity) => identity.id === clerkUserId,
        )
      ) {
        return Response.json({ error: "invalid_profile" }, { status: 400 });
      }
      const now = new Date();
      const adapters = createMockAdapters();
      await deleteClerkProfile({
        repository: adapters.neon,
        portal: adapters.portal,
        tombstone: {
          clerkUserId,
          sourceVersion: now.getTime(),
          deletedAt: now,
        },
        now,
      });
      break;
    }
    default:
      return Response.json({ error: "invalid_intent" }, { status: 400 });
  }
  return new Response(null, { status: 204 });
}
