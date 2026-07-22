import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";
import {
  isAuthorizedVercelCronRequest,
  runOfficeDayCron,
} from "@/lib/office-days/cron";

export const runtime = "nodejs";

export async function GET(request: Request) {
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
    console.error(
      JSON.stringify({
        operation: "office_day_cron",
        authority: "neon_portal",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return Response.json({ error: "office_day_seed_failed" }, { status: 503 });
  }
}
