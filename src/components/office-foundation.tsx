"use client";

import { useUser } from "@clerk/nextjs";
import { MessengerSignIn } from "@/components/messenger-sign-in";
import { OfficeWindow } from "@/components/office-window";
import { PortalChat } from "@/components/portal-chat";

export function OfficeFoundation({
  publishableKey,
}: {
  publishableKey: string;
}) {
  const { isLoaded, user } = useUser();

  return (
    <main className="office-shell">
      <OfficeWindow>
        {isLoaded && user ? (
          <PortalChat
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
