import { SignInButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { OfficeFoundation } from "@/components/office-foundation";

export default async function HomePage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="office-shell">
        <section className="observer-teaser">
          <p className="eyebrow">Portal Messenger: Corporate Edition</p>
          <h1>Learn realtime chat by using the Portal primitives directly.</h1>
          <p>
            Sign in to explore messages, history, presence, typing, unread
            state, and broadcast channels.
          </p>
          <SignInButton mode="modal">
            <button type="button">Clock in with Clerk</button>
          </SignInButton>
        </section>
      </main>
    );
  }
  const publishableKey = process.env.NEXT_PUBLIC_PORTAL_KEY;
  if (!publishableKey) throw new Error("NEXT_PUBLIC_PORTAL_KEY is required.");
  const user = await currentUser();
  return (
    <OfficeFoundation
      profile={{
        id: userId,
        name: user?.fullName ?? user?.firstName ?? "New Hire",
        imageUrl: user?.imageUrl || null,
      }}
      publishableKey={publishableKey}
    />
  );
}
