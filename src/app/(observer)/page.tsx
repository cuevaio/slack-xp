import { OfficeFoundation } from "@/components/office-foundation";

export default function HomePage() {
  const publishableKey = process.env.NEXT_PUBLIC_PORTAL_KEY;
  if (!publishableKey) throw new Error("NEXT_PUBLIC_PORTAL_KEY is required.");
  return <OfficeFoundation publishableKey={publishableKey} />;
}
