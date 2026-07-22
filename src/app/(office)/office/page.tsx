import { connection } from "next/server";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { OfficeFoundation } from "@/components/office-foundation";
import { createServiceAdapters } from "@/lib/adapters";
import { requireOfficeIdentity } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";

export const runtime = "nodejs";

export default async function OfficePage() {
  await connection();
  const configuration = readAppConfiguration();

  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  const identity = await requireOfficeIdentity(configuration);
  const adapters = createServiceAdapters(configuration);
  return <OfficeFoundation adapters={adapters} identity={identity} />;
}
