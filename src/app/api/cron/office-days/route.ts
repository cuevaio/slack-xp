import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";
import {
  isAuthorizedVercelCronRequest,
  runOfficeDayCron,
} from "@/lib/office-days/cron";
import { portalOrNeonAuthority } from "@/lib/safety/failure-authority";
import { logSafetyEvent, requestCorrelationId } from "@/lib/safety/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const correlationId = requestCorrelationId(request.headers);
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!cronSecret) {
    return Response.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!isAuthorizedVercelCronRequest(request, cronSecret)) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }

  try {
    const result = await runOfficeDayCron({
      adapters: createServiceAdapters(configuration),
      now: new Date(),
    });
    return Response.json(result, { status: result.failed > 0 ? 503 : 200 });
  } catch (error) {
    logSafetyEvent({
      operation: "office_day_cron",
      correlationId,
      authority: portalOrNeonAuthority(error),
      status: "unavailable",
    });
    return Response.json({ error: "office_day_seed_failed" }, { status: 503 });
  }
}
