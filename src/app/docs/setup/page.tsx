import Link from "next/link";
import { LIVE_ENVIRONMENT_VARIABLES } from "@/lib/config";

export default function SetupPage() {
  return (
    <main className="installation-shell">
      <article className="system-window">
        <header className="window-titlebar">
          <span>Portal Messenger Setup Guide</span>
          <span aria-hidden="true">?</span>
        </header>
        <div className="installation-content">
          <div className="warning-icon" aria-hidden="true">
            i
          </div>
          <div>
            <p className="eyebrow">Fork-safe configuration</p>
            <h1>Connect your services</h1>
            <p>
              Copy <code>.env.example</code> to <code>.env.local</code>, select
              <code> SERVICE_MODE=live</code>, and configure these variables:
            </p>
            <ul className="variable-list">
              {LIVE_ENVIRONMENT_VARIABLES.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                  <span>required</span>
                </li>
              ))}
            </ul>
            <p>
              Use separate Clerk, Portal, and Neon resources for production.
              Never expose values without a <code>NEXT_PUBLIC_</code> prefix to
              browser code. Restart the development server after changing the
              environment.
            </p>
            <p>
              Set <code>APP_ORIGIN</code> to the exact browser origin registered
              with Clerk and Portal. Local and preview deployments share a
              development service stack; Vercel Production uses a separate
              production stack. Select one Vercel Function region near Neon in
              <code> vercel.json</code>.
            </p>
            <p>
              Generate a long <code>CRON_SECRET</code> in Vercel. The scheduled
              midnight UTC request uses it as a bearer token when creating and
              publishing the next Office Day; authenticated entry uses the same
              retry-safe repair if Cron is delayed.
            </p>
            <h2>Configure Clerk sign-in</h2>
            <p>
              In the Clerk Dashboard, enable the hosted social connections and
              email verification-code strategy you want New Hires to use. This
              application redirects to Clerk&apos;s hosted Account Portal and
              does not add passwords, invitations, organizations, or its own
              account records.
            </p>
            <p>
              Set <code>OPERATOR_CLERK_USER_IDS</code> to a comma- or
              whitespace-separated list of exact Clerk user IDs that should act
              as Operators. This value is server-only and is rechecked on every
              private queue read and dismissal. Empty values and any malformed
              entry fail closed with no Operator access. Those Operators receive
              private targeted Portal inbox items and can review and dismiss HR
              Reports inline.
            </p>
            <h2>Project current Clerk profiles</h2>
            <p>
              Add <code>https://your-deployment/api/webhooks/clerk</code> as a
              Clerk webhook endpoint and subscribe it to{" "}
              <code>user.created</code> and <code>user.updated</code>. Copy that
              endpoint&apos;s signing secret into{" "}
              <code>CLERK_WEBHOOK_SECRET</code>. The handler rejects unsigned
              deliveries before reading their profile data.
            </p>
            <p>
              Profile writes are ordered by Clerk&apos;s source timestamp, and
              authenticated entry repairs missed deliveries. Portal messages
              retain only the stable Clerk user ID; names and pictures are
              resolved from the current Neon projection in TanStack Query
              batches. A lightweight reserved-sender Portal event invalidates
              only batches containing the changed New Hire.
            </p>
            <p>
              The Employee Record editor updates Clerk before reporting success.
              It may briefly show that the Shared Public Office is still
              updating while the verified webhook or authenticated repair
              converges in Neon. Keep the webhook enabled so connected clients
              receive profile changes promptly.
            </p>
            <h2>Apply the Neon schema</h2>
            <p>
              With <code>DATABASE_URL</code> available in the command
              environment, run <code>bun run db:migrate</code> once for each
              Neon environment before deploying. Migrations are never run by
              application startup, development startup, or the Next.js build.
            </p>
            <p>
              The migrations create Clerk profile projections, a retry-safe
              profile invalidation outbox, resumable New Hire onboarding
              records, Office Days, the scripted System Event outbox, and
              body-free HR Report workflow and notification-outbox records. The
              review migration also adds one-way report dismissal fields and
              uniquely constrained private Operator audit records containing
              stable actor and target IDs, timestamps, action, and an optional
              private note. Later migrations add body-free Removed Message
              projections with matching HR Report resolution and an invalidation
              outbox, plus expiring Send Home employment actions. Send Home
              stores stable actor and target IDs, the UTC Office Day and
              next-midnight expiry, a required private reason, and retry-safe
              effect delivery state. Message and New Hire Profile reports use
              separate open-report uniqueness rules. Profile reports retain only
              stable Clerk IDs, so later edits or deletion do not copy or
              preserve public names and pictures. The outboxes contain stable
              references, attempt state, and delivery timestamps, never profile
              values, message bodies, previews, or presence. Portal remains the
              authority for messages and conversation state.
            </p>
            <p>
              Removed Message is an application-level Portal Messenger state,
              not Portal retraction or hard deletion. Normal live and paginated
              history renders a tombstone, but an authorized client accessing
              Portal directly may still retrieve the original payload. Private
              Operator reasons remain in Neon audits and are never published in
              invalidation events.
            </p>
            <h2>Prove production readiness</h2>
            <p>
              Run <code>bun run setup:check</code> after migrations and Portal
              configuration are deployed. It checks Neon and Clerk, then proves
              Portal authentication, policy, origins, publishing, and persistent
              history. Exit code <code>0</code> means ready, <code>1</code>{" "}
              means failed, and <code>2</code> means non-production credentials
              were unavailable.
            </p>
            <Link className="classic-button" href="/office">
              Recheck installation
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
