import { OfficeWindow } from "@/components/office-window";
import { PortalChat } from "@/components/portal-chat";

export function OfficeFoundation({
  profile,
  publishableKey,
}: {
  profile: { id: string; name: string; imageUrl: string | null };
  publishableKey: string;
}) {
  return (
    <main className="office-shell">
      <OfficeWindow>
        <PortalChat profile={profile} publishableKey={publishableKey} />
      </OfficeWindow>
    </main>
  );
}
