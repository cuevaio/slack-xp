import type { Metadata } from "next";
import { ObserverTeaser } from "@/components/observer-teaser";

export const metadata: Metadata = {
  title: "Portal Messenger: Corporate Edition",
  description:
    "Preview the Shared Public Office from a delightfully outdated Portal Systems desktop.",
};

export default function ObserverPage() {
  return <ObserverTeaser />;
}
