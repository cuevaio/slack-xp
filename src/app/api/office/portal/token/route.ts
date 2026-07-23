import { auth, currentUser } from "@clerk/nextjs/server";
import { createPortalSession } from "@/lib/portal/server";

export async function POST() {
  const { userId } = await auth();
  if (!userId)
    return Response.json({ error: "authentication_required" }, { status: 401 });
  const user = await currentUser();
  if (!user || user.id !== userId)
    return Response.json({ error: "authentication_required" }, { status: 401 });
  const secret = process.env.PORTAL_SECRET;
  if (!secret)
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  const name = user.fullName ?? user.firstName ?? "New Hire";
  try {
    const session = await createPortalSession(secret, {
      id: user.id,
      name,
      imageUrl: user.imageUrl || null,
    });
    return Response.json(session, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch {
    return Response.json({ error: "portal_unavailable" }, { status: 503 });
  }
}
