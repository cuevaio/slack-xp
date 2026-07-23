import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { officeNowForRequest } from "@/lib/portal/request-controls";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }
  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const adapters = createServiceAdapters(configuration);
  const access = await adapters.neon.getEmploymentAccess(
    identity.id,
    officeNowForRequest(request.headers, configuration),
  );
  return Response.json(
    {
      eligible: access.eligible,
      reason: access.reason,
      until: access.until?.toISOString() ?? null,
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
