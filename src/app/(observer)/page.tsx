import type { Metadata } from "next";
import { ObserverTeaser } from "@/components/observer-teaser";

export const metadata: Metadata = {
  title: "Portal Messenger: Corporate Edition",
  description:
    "Meet your coworkers in a delightfully outdated shared online office.",
};

export default function ObserverPage() {
  return <ObserverTeaser />;
}
