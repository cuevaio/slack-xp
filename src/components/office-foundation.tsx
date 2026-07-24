"use client";

import { useUser } from "@clerk/nextjs";
import { useState } from "react";
import { MessengerSignIn } from "@/components/messenger-sign-in";
import { OfficeWindow } from "@/components/office-window";
import { PortalChat } from "@/components/portal-chat";

export function OfficeFoundation({
  publishableKey,
}: {
  publishableKey: string;
}) {
  const { isLoaded, user } = useUser();
  const [portalReady, setPortalReady] = useState(false);

  return (
    <main className="office-shell">
      <OfficeWindow
        onStart={() => setPortalReady(false)}
        ready={isLoaded && (!user || portalReady)}
      >
        {isLoaded && user ? (
          <PortalChat
            onReady={() => setPortalReady(true)}
            profile={{
              id: user.id,
              name: user.fullName ?? user.firstName ?? "New Hire",
              imageUrl: user.imageUrl || null,
            }}
            publishableKey={publishableKey}
          />
        ) : (
          <MessengerSignIn isLoading={!isLoaded} />
        )}
      </OfficeWindow>
    </main>
  );
}
