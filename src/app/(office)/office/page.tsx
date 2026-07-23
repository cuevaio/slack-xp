import { headers } from "next/headers";
import { connection } from "next/server";
import { EmploymentAccessEnded } from "@/components/employment-access-ended";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { OfficeFoundation } from "@/components/office-foundation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { SafetyUnavailable } from "@/components/safety-unavailable";
import { createServiceAdapters } from "@/lib/adapters";
import { requireOfficeIdentity } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import type { EmploymentAccessDecision } from "@/lib/employment/contract";
import { profileFromIdentity } from "@/lib/onboarding/profile-authority";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import { officeNowForRequest } from "@/lib/portal/request-time";
import { SAFETY_PROJECTION_TIMEOUT_MS } from "@/lib/safety/contract";
import {
  isMaintenanceActive,
  logSafetyEvent,
  requestCorrelationId,
  withSafetyDependencyTimeout,
} from "@/lib/safety/server";

export const runtime = "nodejs";

export default async function OfficePage() {
  await connection();
  const configuration = readAppConfiguration();

  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  const identity = await requireOfficeIdentity(configuration);
  if (isMaintenanceActive()) {
    return <SafetyUnavailable reason="maintenance" />;
  }
  const adapters = createServiceAdapters(configuration);
  const requestHeaders = await headers();
  const correlationId = requestCorrelationId(requestHeaders);
  const now = officeNowForRequest(requestHeaders, configuration);
  let onboarding: OnboardingSnapshot;
  try {
    onboarding = await withSafetyDependencyTimeout(
      adapters.neon.enterNewHire(profileFromIdentity(identity)),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
  } catch {
    logSafetyEvent({
      operation: "office_entry",
      correlationId,
      authority: "neon",
      status: "unavailable",
    });
    return <SafetyUnavailable reason="projection" />;
  }

  if (onboarding.step !== "complete") {
    return (
      <OnboardingWizard
        initialOnboarding={onboarding}
        isMock={adapters.kind === "mock"}
      />
    );
  }

  let employmentAccess: EmploymentAccessDecision;
  try {
    employmentAccess = await withSafetyDependencyTimeout(
      adapters.neon.getEmploymentAccess(identity.id, now),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
  } catch {
    logSafetyEvent({
      operation: "employment_access",
      correlationId,
      authority: "neon",
      status: "unavailable",
    });
    return <SafetyUnavailable reason="projection" />;
  }
  if (!employmentAccess.eligible) {
    return <EmploymentAccessEnded access={employmentAccess} />;
  }

  return (
    <OfficeFoundation
      adapters={adapters}
      identity={identity}
      onboarding={onboarding}
      now={now}
      portalPublishableKey={configuration.values.NEXT_PUBLIC_PORTAL_KEY}
    />
  );
}
