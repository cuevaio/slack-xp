import Link from "next/link";
import { redirect } from "next/navigation";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { readAppConfiguration } from "@/lib/config";

export const runtime = "nodejs";

export default function SignInPage() {
  const configuration = readAppConfiguration();

  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  if (configuration.serviceMode === "live") {
    redirect("/office");
  }

  return (
    <main className="installation-shell">
      <output className="mock-watermark">Development mode</output>
      <section className="system-window" aria-labelledby="sign-in-title">
        <header className="window-titlebar">
          <span>Portal Messenger</span>
        </header>
        <div className="mock-sign-in-content">
          <h1 id="sign-in-title">Choose a test identity</h1>
          <p>This sign-in screen is available only in development.</p>
          <div className="mock-sign-in-actions">
            <form action="/api/auth/mock-session" method="post">
              <input type="hidden" name="identity" value="new-hire" />
              <button className="classic-button" type="submit">
                Sign in as New Hire
              </button>
            </form>
            <form action="/api/auth/mock-session" method="post">
              <input type="hidden" name="identity" value="operator" />
              <button className="classic-button" type="submit">
                Sign in as Operator
              </button>
            </form>
            <form action="/api/auth/mock-session" method="post">
              <input type="hidden" name="identity" value="returning-new-hire" />
              <button className="classic-button" type="submit">
                Sign in as Returning New Hire
              </button>
            </form>
          </div>
          <Link href="/">Return to Observer preview</Link>
        </div>
      </section>
    </main>
  );
}
