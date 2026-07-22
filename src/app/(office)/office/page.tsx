import { connection } from "next/server";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { OfficeFoundation } from "@/components/office-foundation";
import { createServiceAdapters } from "@/lib/adapters";
import { readAppConfiguration } from "@/lib/config";

export default async function OfficePage() {
  await connection();
  const configuration = readAppConfiguration();

  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  const adapters = createServiceAdapters(configuration);
  return <OfficeFoundation adapters={adapters} />;
}
