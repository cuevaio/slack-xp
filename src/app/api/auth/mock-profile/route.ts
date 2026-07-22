import { isMockAuthenticationAllowed } from "@/lib/auth/mock-session";
import { readAppConfiguration } from "@/lib/config";
import {
  delayNextMockProfileProjection,
  failNextMockProfileUpdate,
} from "@/lib/onboarding/profile-authority";

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
    default:
      return Response.json({ error: "invalid_intent" }, { status: 400 });
  }
  return new Response(null, { status: 204 });
}
