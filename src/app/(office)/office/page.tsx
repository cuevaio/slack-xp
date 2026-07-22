import { headers } from "next/headers";
import { connection } from "next/server";
import { EmploymentAccessEnded } from "@/components/employment-access-ended";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { OfficeFoundation } from "@/components/office-foundation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { createServiceAdapters } from "@/lib/adapters";
import { requireOfficeIdentity } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { profileFromIdentity } from "@/lib/onboarding/profile-authority";
import { officeNowForRequest } from "@/lib/portal/request-time";

export const runtime = "nodejs";

export default async function OfficePage() {
  await connection();
  const configuration = readAppConfiguration();

  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  const identity = await requireOfficeIdentity(configuration);
  const adapters = createServiceAdapters(configuration);
  const now = officeNowForRequest(await headers(), configuration);
  const onboarding = await adapters.neon.enterNewHire(
    profileFromIdentity(identity),
  );

  if (onboarding.step !== "complete") {
    return (
      <OnboardingWizard
        initialOnboarding={onboarding}
        isMock={adapters.kind === "mock"}
      />
    );
  }

  const employmentAccess = await adapters.neon.getEmploymentAccess(
    identity.id,
    now,
  );
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
