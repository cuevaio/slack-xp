import { redirect } from "next/navigation";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { readAppConfiguration } from "@/lib/config";

export const runtime = "nodejs";

export default function SignInPage() {
  const configuration = readAppConfiguration();

  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  redirect("/office");
}
