"use client";

import Link from "next/link";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";

const OFFICE_HREF = "/office";
const OFFICE_LINK_LABEL = "Enter the Shared Public Office";
const PREVIEW_WINDOW_TITLE = "general — Portal Messenger";

const previewMessages = [
  {
    initials: "CL",
    name: "Clippy from Legal",
    time: "8:42 AM",
    message: "Please stop calling the outage a surprise migration.",
    tone: "gold",
  },
  {
    initials: "PP",
    name: "Pat Pending",
    time: "8:47 AM",
    message: "Does anyone know which printer is the production server?",
    tone: "mint",
  },
  {
    initials: "IT",
    name: "Portal Systems IT",
    time: "9:01 AM",
    message: "The quarterly synergy has been rebooted successfully.",
    tone: "blue",
  },
] as const;
const mobilePreviewMessages = previewMessages.slice(0, 2);

type PreviewState = "open" | "minimized" | "closed";
type HiddenPreviewState = Exclude<PreviewState, "open">;

function getPreviewTaskLabel(previewState: PreviewState) {
  switch (previewState) {
    case "minimized":
      return "Restore observer preview window";
    case "closed":
      return "Reopen observer preview window";
    case "open":
      return "Focus observer preview window";
  }
}

function getHiddenPreviewMessage(previewState: HiddenPreviewState) {
  switch (previewState) {
    case "minimized":
      return "Preview window minimized";
    case "closed":
      return "Preview window closed";
  }
}

function PortalMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "portal-mark portal-mark-small" : "portal-mark"}>
      <span aria-hidden="true">P</span>
      <span className="sr-only">Portal Systems</span>
    </span>
  );
}

function PortalWordmark({ subtitle }: { subtitle: string }) {
  return (
    <div className="desktop-wordmark">
      <PortalMark />
      <div>
        <strong>PORTAL SYSTEMS</strong>
        <span className="wordmark-subtitle">{subtitle}</span>
      </div>
    </div>
  );
}

function PreviewAvatar({
  initials,
  tone,
}: {
  initials: string;
  tone: (typeof previewMessages)[number]["tone"];
}) {
  return (
    <div className={`avatar avatar-${tone}`} aria-hidden="true">
      {initials}
    </div>
  );
}

interface PreviewWindowProps {
  maximized: boolean;
  minimizeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
}

function PreviewWindow({
  maximized,
  minimizeButtonRef,
  onClose,
  onMinimize,
  onToggleMaximize,
}: PreviewWindowProps) {
  return (
    <section
      className={`preview-window${maximized ? " preview-window-maximized" : ""}`}
      aria-label="Non-live product preview"
    >
      <header className="window-titlebar observer-titlebar">
        <span className="window-title">
          <PortalMark compact />
          {PREVIEW_WINDOW_TITLE}
        </span>
        <span className="window-controls">
          <button
            ref={minimizeButtonRef}
            type="button"
            aria-label="Minimize observer preview window"
            onClick={onMinimize}
          >
            <span aria-hidden="true">_</span>
          </button>
          <button
            type="button"
            aria-label={
              maximized
                ? "Restore observer preview window size"
                : "Maximize observer preview window"
            }
            aria-pressed={maximized}
            onClick={onToggleMaximize}
          >
            <span aria-hidden="true">□</span>
          </button>
          <button
            type="button"
            aria-label="Close observer preview window"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      </header>
      <div className="preview-toolbar" aria-hidden="true">
        <span>File</span>
        <span>Edit</span>
        <span>Coworkers</span>
        <span>Help</span>
      </div>
      <div className="preview-channelbar">
        <div>
          <strong># general</strong>
          <span>The hallway, but with more reply-all.</span>
        </div>
        <Badge className="static-badge" variant="warning">
          Static preview
        </Badge>
      </div>
      <div className="preview-messages">
        {previewMessages.map((message) => (
          <article key={message.name}>
            <PreviewAvatar initials={message.initials} tone={message.tone} />
            <div>
              <div className="message-meta">
                <strong>{message.name}</strong>
                <time>{message.time}</time>
              </div>
              <p>{message.message}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="preview-compose" aria-hidden="true">
        <span>Observers cannot send messages.</span>
        <span className="compose-button">Send</span>
      </div>
      <footer className="preview-status">
        <span>STATIC PREVIEW</span>
        <span>0 LIVE CONNECTIONS</span>
      </footer>
    </section>
  );
}

function HiddenPreviewNotice({ state }: { state: HiddenPreviewState }) {
  return (
    <output className="window-state-note">
      <PortalMark compact />
      <div>
        <strong>{getHiddenPreviewMessage(state)}</strong>
        <span className="window-state-help">
          Use the taskbar button to bring it back.
        </span>
      </div>
    </output>
  );
}

function MobileObserverTeaser() {
  return (
    <section className="observer-mobile" aria-labelledby="mobile-teaser-title">
      <header className="mobile-brandbar">
        <PortalWordmark subtitle="Corporate Edition" />
        <span className="mobile-offline-badge">OFFLINE PREVIEW</span>
      </header>
      <div className="mobile-hero">
        <p className="eyebrow">No desktop required</p>
        <h1 id="mobile-teaser-title">Clock in from your pocket.</h1>
        <p>
          See the Shared Public Office before you join it. Same questionable
          coworkers, now sized for thumbs.
        </p>
      </div>
      <section className="mobile-preview" aria-label="Non-live product preview">
        <header>
          <span>
            <span className="status-pip" aria-hidden="true" /># general
          </span>
          <span>STATIC</span>
        </header>
        {mobilePreviewMessages.map((message) => (
          <article key={message.name}>
            <PreviewAvatar initials={message.initials} tone={message.tone} />
            <div>
              <strong>{message.name}</strong>
              <p>{message.message}</p>
            </div>
          </article>
        ))}
        <footer>NO LIVE CONNECTIONS · NOTHING IS LOADING</footer>
      </section>
      <Link
        className="mobile-primary-action"
        href={OFFICE_HREF}
        prefetch={false}
      >
        {OFFICE_LINK_LABEL}
        <span className="mobile-action-arrow" aria-hidden="true">
          →
        </span>
      </Link>
      <p className="mobile-privacy-note">
        This is designed teaser content. Portal clients, messages, presence,
        typing, unread state, and credentials stay on the other side of sign-in.
      </p>
    </section>
  );
}

export function ObserverTeaser() {
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>("open");
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const startLinkRef = useRef<HTMLAnchorElement>(null);
  const previewTaskRef = useRef<HTMLButtonElement>(null);
  const minimizeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!startMenuOpen) {
      return;
    }

    startLinkRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setStartMenuOpen(false);
      startButtonRef.current?.focus();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [startMenuOpen]);

  const hidePreview = (nextState: HiddenPreviewState) => {
    setStartMenuOpen(false);
    setPreviewState(nextState);
    requestAnimationFrame(() => previewTaskRef.current?.focus());
  };

  const activatePreview = () => {
    setPreviewState("open");
    requestAnimationFrame(() => minimizeButtonRef.current?.focus());
  };

  const previewTaskLabel = getPreviewTaskLabel(previewState);

  return (
    <main className="observer-shell">
      <section
        className="observer-desktop"
        aria-label="Portal Systems desktop teaser"
      >
        <div className="desktop-glow desktop-glow-one" aria-hidden="true" />
        <div className="desktop-glow desktop-glow-two" aria-hidden="true" />

        <div className="desktop-workspace">
          <section
            className="observer-copy"
            aria-hidden={startMenuOpen || undefined}
          >
            <PortalWordmark subtitle="Connecting people to mandatory fun." />
            <p className="eyebrow">Corporate intranet / external access</p>
            <h1>
              Your coworkers are online.
              <span>Management remains unavailable.</span>
            </h1>
            <p className="observer-lede">
              Portal Messenger is one communal realtime office, thoughtfully
              wrapped in the warm gray plastic of corporate software from 2001.
            </p>
            <div className="observer-actions">
              <Link
                className="primary-action"
                href={OFFICE_HREF}
                prefetch={false}
                tabIndex={startMenuOpen ? -1 : undefined}
              >
                {OFFICE_LINK_LABEL}
                <span aria-hidden="true"> →</span>
              </Link>
              <span className="observer-version">
                v4.0.01 / Definitely stable
              </span>
            </div>
            <p className="privacy-note">
              <span className="status-pip" aria-hidden="true" />
              Observer preview only. Live messages, presence, typing, unread
              state, and Portal services are not loaded here.
            </p>
          </section>

          <div className="preview-stage">
            {previewState === "open" ? (
              <PreviewWindow
                maximized={previewMaximized}
                minimizeButtonRef={minimizeButtonRef}
                onClose={() => hidePreview("closed")}
                onMinimize={() => hidePreview("minimized")}
                onToggleMaximize={() => setPreviewMaximized((value) => !value)}
              />
            ) : (
              <HiddenPreviewNotice state={previewState} />
            )}
          </div>
        </div>

        {startMenuOpen ? (
          <div className="start-menu" role="menu" aria-label="Start menu">
            <div className="start-menu-rail" aria-hidden="true">
              <span className="start-rail-name">PORTAL</span>
              <strong className="start-rail-year">2001</strong>
            </div>
            <div className="start-menu-content">
              <header>
                <PortalMark />
                <div>
                  <strong>Observer</strong>
                  <span>Signed out / delightfully offline</span>
                </div>
              </header>
              <Link
                ref={startLinkRef}
                className="start-menu-entry"
                href={OFFICE_HREF}
                prefetch={false}
              >
                <span className="start-entry-icon" aria-hidden="true">
                  ↗
                </span>
                <span>
                  <strong>{OFFICE_LINK_LABEL}</strong>
                  <small>Clock in and meet the New Hires</small>
                </span>
              </Link>
              <div className="start-menu-status">
                <span className="status-pip" aria-hidden="true" />
                Teaser mode · no live services
              </div>
            </div>
          </div>
        ) : null}

        <footer className="desktop-taskbar">
          <button
            ref={startButtonRef}
            type="button"
            className={`start-button${startMenuOpen ? " start-button-active" : ""}`}
            aria-label={startMenuOpen ? "Close Start menu" : "Open Start menu"}
            aria-haspopup="menu"
            aria-expanded={startMenuOpen}
            onClick={() => setStartMenuOpen((value) => !value)}
          >
            <PortalMark compact />
            <span>Start</span>
          </button>
          <div className="taskbar-divider" aria-hidden="true" />
          <button
            ref={previewTaskRef}
            type="button"
            className={`preview-task${previewState !== "open" ? " preview-task-attention" : ""}`}
            aria-label={previewTaskLabel}
            onClick={activatePreview}
          >
            <PortalMark compact />
            <span>{PREVIEW_WINDOW_TITLE}</span>
          </button>
          <div className="taskbar-tray">
            <span className="tray-offline" aria-hidden="true">
              ×
            </span>
            <span className="sr-only">Teaser is offline</span>
            <time dateTime="2001-07-22T09:01">9:01 AM</time>
          </div>
        </footer>
      </section>

      <MobileObserverTeaser />
    </main>
  );
}
