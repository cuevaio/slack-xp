import { getMockPortalAdapter } from "@/lib/adapters/mock";
import { isMockAuthenticationAllowed } from "@/lib/auth/mock-session";
import { readAppConfiguration } from "@/lib/config";

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
  const intent = formData.get("intent");
  const portal = getMockPortalAdapter();
  switch (intent) {
    case "online":
      portal.setOnline(true);
      break;
    case "offline":
      portal.setOnline(false);
      break;
    case "fail-next-send":
      portal.failNextSend();
      break;
    default:
      return Response.json({ error: "invalid_intent" }, { status: 400 });
  }
  return new Response(null, { status: 204 });
}
