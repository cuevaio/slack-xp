import { resetMockOnboarding } from "@/lib/adapters/mock";
import { isMockAuthenticationAllowed } from "@/lib/auth/mock-session";
import { readAppConfiguration } from "@/lib/config";

export const runtime = "nodejs";

export async function POST() {
  const configuration = readAppConfiguration();
  if (
    !isMockAuthenticationAllowed(configuration) ||
    configuration.environment !== "test"
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  resetMockOnboarding();
  return new Response(null, { status: 204 });
}
