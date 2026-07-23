"use client";

import { SignIn } from "@clerk/nextjs";
import { useState } from "react";

const clerkAppearance = {
  variables: {
    colorBackground: "#fffef6",
    colorForeground: "#101424",
    colorInput: "#ffffff",
    colorInputForeground: "#101424",
    colorPrimary: "#173b9b",
    colorMutedForeground: "#5f5a4e",
    borderRadius: "2px",
    fontFamily: "var(--font-geist-pixel-square), monospace",
  },
  elements: {
    rootBox: "portal-clerk-root",
    cardBox: "portal-clerk-card-box",
    card: "portal-clerk-card",
    header: "portal-clerk-header",
    headerTitle: "portal-clerk-title",
    headerSubtitle: "portal-clerk-subtitle",
    socialButtonsBlockButton: "portal-clerk-provider-button",
    socialButtonsBlockButtonText: "portal-clerk-provider-text",
    dividerLine: "portal-clerk-divider-line",
    dividerText: "portal-clerk-divider-text",
    formFieldLabel: "portal-clerk-label",
    formFieldInput: "portal-clerk-input",
    formButtonPrimary: "portal-clerk-submit",
    footer: "portal-clerk-footer",
    footerActionLink: "portal-clerk-link",
    identityPreview: "portal-clerk-identity",
    formResendCodeLink: "portal-clerk-link",
    otpCodeFieldInput: "portal-clerk-otp",
    alert: "portal-clerk-alert",
  },
};

export function MessengerSignIn({ isLoading }: { isLoading: boolean }) {
  const [isSigningIn, setIsSigningIn] = useState(false);

  if (isLoading) {
    return (
      <div aria-live="polite" className="messenger-auth-loading">
        <span className="portal-mark">P</span>
        <strong>Checking employee credentials...</strong>
      </div>
    );
  }

  return (
    <div className="messenger-auth-shell">
      <aside className="messenger-auth-sidebar" aria-hidden="true">
        <span className="portal-mark messenger-auth-mark">P</span>
        <strong>PORTAL SYSTEMS</strong>
        <small>COMMUNICATIONS DIVISION</small>
        <div className="messenger-auth-status">
          <span className="messenger-auth-status-light" /> OFFICE SERVER ONLINE
        </div>
      </aside>

      <section className="messenger-auth-content">
        {isSigningIn ? (
          <>
            <button
              className="messenger-auth-back"
              onClick={() => setIsSigningIn(false)}
              type="button"
            >
              &lt; Back to welcome
            </button>
            <div className="messenger-auth-clerk">
              <SignIn
                appearance={clerkAppearance}
                forceRedirectUrl="/"
                routing="hash"
              />
            </div>
          </>
        ) : (
          <div className="messenger-auth-welcome">
            <p className="messenger-auth-kicker">INTERNAL USE ONLY</p>
            <h1>Welcome to Portal Messenger</h1>
            <p>
              Sign in with your employee credentials to enter the Shared Public
              Office.
            </p>
            <div className="messenger-auth-notice">
              <strong>NOTICE</strong>
              <span>
                Your session stays inside Portal Messenger. The desktop and
                other applications remain available without an account.
              </span>
            </div>
            <button
              className="messenger-auth-button"
              onClick={() => setIsSigningIn(true)}
              type="button"
            >
              Sign in to Portal Messenger
            </button>
            <small className="messenger-auth-help">
              Authentication services provided by Clerk
            </small>
          </div>
        )}
      </section>
    </div>
  );
}
