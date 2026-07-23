import { OfficeWindow } from "@/components/office-window";
import { PortalChat } from "@/components/portal-chat";
import { listOfficeChannelsForDay } from "@/lib/portal/channels";
import { officeDay } from "@/lib/portal/office-day";

export function ObserverTeaser() {
  return (
    <main className="office-shell">
      <OfficeWindow>
        <PortalChat
          channels={listOfficeChannelsForDay(officeDay())}
          mode="observer"
        />
      </OfficeWindow>
    </main>
  );
}
