"use client";

import Image from "next/image";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

type WindowState = "open" | "minimized" | "closed" | "loading";

export function OfficeWindow({ children }: { children: ReactNode }) {
  const [windowState, setWindowState] = useState<WindowState>("closed");

  useEffect(() => {
    if (windowState !== "loading") return;

    const loadingTimer = window.setTimeout(() => setWindowState("open"), 1200);
    return () => window.clearTimeout(loadingTimer);
  }, [windowState]);

  function openMessenger() {
    if (windowState === "minimized") {
      setWindowState("open");
    } else if (windowState === "closed") {
      setWindowState("loading");
    }
  }

  function handleIconKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      openMessenger();
    }
  }

  return (
    <>
      <button
        aria-label="Portal Messenger. Double click to open."
        className="desktop-app-icon"
        onDoubleClick={openMessenger}
        onKeyDown={handleIconKeyDown}
        type="button"
      >
        <span aria-hidden="true" className="desktop-app-icon-art">
          <span className="portal-mark portal-mark-small">P</span>
        </span>
        <span>Portal Messenger</span>
      </button>

      <a
        aria-label="Open the Portal Messenger GitHub repository"
        className="desktop-app-icon desktop-github-icon"
        href="https://github.com/cuevaio/slack-xp"
        rel="noreferrer"
        target="_blank"
      >
        <span
          aria-hidden="true"
          className="desktop-app-icon-art github-icon-art"
        >
          <svg viewBox="0 0 24 24">
            <title>GitHub</title>
            <path
              d="M12 .7a11.6 11.6 0 0 0-3.7 22.6c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.2 1.9 1.2 1.1 1.9 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.4-5.5-5.8 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.6 11.6 0 0 0 12 .7Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span>GitHub Repository</span>
      </a>

      <a
        aria-label="Open the Portal website"
        className="desktop-app-icon desktop-portal-icon"
        href="https://useportal.co/"
        rel="noreferrer"
        target="_blank"
      >
        <span
          aria-hidden="true"
          className="desktop-app-icon-art portal-link-art"
        >
          <Image
            alt=""
            className="portal-link-logo"
            height={34}
            src="/logo-portal.svg"
            width={34}
          />
        </span>
        <span>Portal</span>
      </a>

      <a
        aria-label="Open the Portal documentation"
        className="desktop-app-icon desktop-portal-docs-icon"
        href="https://docs.useportal.co/"
        rel="noreferrer"
        target="_blank"
      >
        <span
          aria-hidden="true"
          className="desktop-app-icon-art portal-docs-art"
        >
          <span className="portal-docs-pages">
            <span />
            <span />
          </span>
        </span>
        <span>Portal Docs</span>
      </a>

      {windowState === "loading" ? (
        <section
          aria-label="Portal Messenger startup"
          aria-live="polite"
          className="messenger-loader"
        >
          <header className="window-titlebar">
            <span className="window-title">Portal Messenger</span>
          </header>
          <div className="messenger-loader-body">
            <span className="portal-mark">P</span>
            <strong>Starting Portal Messenger...</strong>
            <div
              aria-label="Loading Portal Messenger"
              className="retro-loading-track"
              role="progressbar"
            >
              <span className="retro-loading-fill" />
            </div>
            <small>Contacting Portal Systems office server</small>
          </div>
        </section>
      ) : null}

      {windowState === "closed" || windowState === "loading" ? null : (
        <section
          aria-labelledby="office-title"
          className="messenger-window"
          hidden={windowState === "minimized"}
        >
          <header className="window-titlebar">
            <span className="window-title" id="office-title">
              Portal Messenger: Corporate Edition
            </span>
            <span className="window-controls">
              <button
                aria-label="Minimize Portal Messenger"
                onClick={() => setWindowState("minimized")}
                title="Minimize"
                type="button"
              >
                <span aria-hidden="true" className="minimize-icon" />
              </button>
              <input
                aria-label="Toggle full screen"
                className="office-fullscreen-toggle sr-only"
                id="office-fullscreen-toggle"
                type="checkbox"
              />
              <label
                className="office-fullscreen-control"
                htmlFor="office-fullscreen-toggle"
                title="Toggle full screen"
              >
                <span aria-hidden="true" className="fullscreen-enter-icon">
                  &#9633;
                </span>
                <span aria-hidden="true" className="fullscreen-exit-icon">
                  &#10064;
                </span>
              </label>
              <button
                aria-label="Close Portal Messenger"
                className="window-close-control"
                onClick={() => setWindowState("closed")}
                title="Close"
                type="button"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </span>
          </header>
          {children}
        </section>
      )}
    </>
  );
}
