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
      <output className="mock-watermark">
        MOCK AUTHENTICATION - TEST ONLY
      </output>
      <section className="system-window" aria-labelledby="sign-in-title">
        <header className="window-titlebar">
          <span>Portal Systems Network Logon</span>
          <span aria-hidden="true">🔑</span>
        </header>
        <div className="mock-sign-in-content">
          <p className="eyebrow">Credential-free development</p>
          <h1 id="sign-in-title">Clock in to the mock office</h1>
          <p>
            These deterministic identities never contact Clerk and are refused
            by production deployments.
          </p>
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
          </div>
          <Link href="/">Return to Observer preview</Link>
        </div>
      </section>
    </main>
  );
}
