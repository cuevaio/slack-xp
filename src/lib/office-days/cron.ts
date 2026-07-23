import type { ServiceAdapters } from "@/lib/adapters/types";
import { seedAndPublishOfficeDay } from "@/lib/office-days/service";
import { officeDay } from "@/lib/portal/office-day";
import { portalOrNeonAuthority } from "@/lib/safety/failure-authority";
import { logSafetyEvent } from "@/lib/safety/server";

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
  correlationId = crypto.randomUUID(),
}: {
  adapters: ServiceAdapters;
  now: Date;
  correlationId?: string;
}) {
  try {
    return await runOfficeDayCron({ adapters, now });
  } catch (error) {
    logSafetyEvent({
      operation: "office_day_lazy_repair",
      correlationId,
      authority: portalOrNeonAuthority(error),
      status: "unavailable",
    });
    return null;
  }
}
