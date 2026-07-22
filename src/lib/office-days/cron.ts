import type { ServiceAdapters } from "@/lib/adapters/types";
import { seedAndPublishOfficeDay } from "@/lib/office-days/service";
import { officeDay } from "@/lib/portal/office-day";

export function isAuthorizedVercelCronRequest(
  request: Pick<Request, "headers">,
  cronSecret: string,
): boolean {
  return (
    cronSecret.length > 0 &&
    request.headers.get("authorization") === `Bearer ${cronSecret}`
  );
}

export async function runOfficeDayCron({
  adapters,
  now,
}: {
  adapters: ServiceAdapters;
  now: Date;
}) {
  return seedAndPublishOfficeDay({
    officeDay: officeDay(now),
    now,
    repository: adapters.neon,
    publisher: adapters.portal,
  });
}

export async function repairOfficeDayOnEntry({
  adapters,
  now,
}: {
  adapters: ServiceAdapters;
  now: Date;
}) {
  try {
    return await runOfficeDayCron({ adapters, now });
  } catch (error) {
    console.error(
      JSON.stringify({
        operation: "office_day_lazy_repair",
        authority: "neon_portal",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return null;
  }
}
