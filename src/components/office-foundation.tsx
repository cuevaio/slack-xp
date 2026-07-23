import { OfficeWindow } from "@/components/office-window";
import { PortalChat } from "@/components/portal-chat";

export function OfficeFoundation({
  publishableKey,
}: {
  publishableKey: string;
}) {
  return (
    <main className="office-shell">
      <OfficeWindow>
        <PortalChat publishableKey={publishableKey} />
      </OfficeWindow>
    </main>
  );
}
