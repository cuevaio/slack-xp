"use client";

import Image from "next/image";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { AppSettingsWindow } from "@/components/app-settings-window";

type WindowState = "open" | "minimized" | "closed" | "loading";

export function OfficeWindow({
  children,
  onStart,
  ready,
}: {
  children: ReactNode;
  onStart: () => void;
  ready: boolean;
}) {
  const [windowState, setWindowState] = useState<WindowState>("closed");
  const [minimumLoadElapsed, setMinimumLoadElapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (windowState !== "loading") return;

    const loadingTimer = window.setTimeout(
      () => setMinimumLoadElapsed(true),
      1200,
    );
    return () => window.clearTimeout(loadingTimer);
  }, [windowState]);

  useEffect(() => {
    if (windowState === "loading" && minimumLoadElapsed && ready) {
      setWindowState("open");
    }
  }, [minimumLoadElapsed, ready, windowState]);

  function openMessenger() {
    if (windowState === "minimized") {
      setWindowState("open");
    } else if (windowState === "closed") {
      setMinimumLoadElapsed(false);
      onStart();
      setWindowState("loading");
    }
  }

  function handleIconClick() {
    if (
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(max-width: 850px)").matches
    )
      openMessenger();
  }

  function handleIconKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      openMessenger();
    }
  }

  function openSettings() {
    setSettingsOpen(true);
  }

  function handleSettingsIconClick() {
    if (
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(max-width: 850px)").matches
    )
      openSettings();
  }

  function handleSettingsIconKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      openSettings();
    }
  }

  return (
    <>
      <button
        aria-label="Portal Messenger. Tap to open on mobile, or double click on desktop."
        className="desktop-app-icon"
        onClick={handleIconClick}
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

      <button
        aria-label="Settings. Tap to open on mobile, or double click on desktop."
        className="desktop-app-icon desktop-settings-icon"
        onClick={handleSettingsIconClick}
        onDoubleClick={openSettings}
        onKeyDown={handleSettingsIconKeyDown}
        type="button"
      >
        <span
          aria-hidden="true"
          className="desktop-app-icon-art settings-desktop-art"
        >
          <svg viewBox="0 0 24 24">
            <title>Settings</title>
            <path d="M9.8 2h4.4l.7 2.5 2 .8L19.2 4l3.1 3.1L21 9.4l.8 2 2.2.6v4.4l-2.5.7-.8 2 1.3 2.3-3.1 3.1-2.3-1.3-2 .8-.6 2.2H9.6l-.7-2.5-2-.8-2.3 1.3-3.1-3.1 1.3-2.3-.8-2-2.2-.6v-4.4l2.5-.7.8-2-1.3-2.3 3.1-3.1L7.2 5l2-.8.6-2.2Zm2.2 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
          </svg>
        </span>
        <span>Settings</span>
      </button>

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

      {windowState === "closed" ? null : (
        <section
          aria-labelledby="office-title"
          className="messenger-window"
          hidden={windowState !== "open"}
        >
          <header className="window-titlebar">
            <span className="window-title" id="office-title">
              <span className="window-title-long">
                Portal Messenger: Corporate Edition
              </span>
              <span className="window-title-short">Portal Messenger</span>
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
      {settingsOpen ? (
        <AppSettingsWindow onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  );
}
