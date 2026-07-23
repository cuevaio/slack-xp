import type { Metadata } from "next";
import { ObserverTeaser } from "@/components/observer-teaser";
import { readAppConfiguration } from "@/lib/config";

export const metadata: Metadata = {
  title: "Portal Messenger: Corporate Edition",
  description:
    "Meet your coworkers in a delightfully outdated shared online office.",
};

export default function ObserverPage() {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") return null;
  return (
    <ObserverTeaser
      publishableKey={configuration.values.NEXT_PUBLIC_PORTAL_KEY}
    />
  );
}
