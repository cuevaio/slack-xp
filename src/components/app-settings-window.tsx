"use client";

import { useEffect, useRef } from "react";
import {
  type AppPreferences,
  useAppPreferences,
} from "@/components/app-preferences";

const PREFERENCE_OPTIONS: ReadonlyArray<{
  key: keyof AppPreferences;
  label: string;
  description: string;
}> = [
  {
    key: "interfaceSounds",
    label: "Play interface sounds",
    description: "Hear clicks when using buttons and controls.",
  },
  {
    key: "typingSounds",
    label: "Play typing sounds",
    description: "Hear keyboard feedback while typing.",
  },
  {
    key: "mentionNotifications",
    label: "Show mention notifications",
    description: "Show a popup and play an alert when someone mentions you.",
  },
];

export function AppSettingsWindow({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { preferences, setPreference } = useAppPreferences();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      aria-labelledby="settings-title"
      className="settings-window"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <header className="window-titlebar">
        <span className="window-title" id="settings-title">
          Portal Messenger Settings
        </span>
        <button
          aria-label="Close settings"
          className="settings-close-control"
          onClick={onClose}
          type="button"
        >
          &times;
        </button>
      </header>
      <div className="settings-window-body">
        <div className="settings-heading">
          <span aria-hidden="true" className="settings-icon">
            *
          </span>
          <div>
            <h2>Sounds &amp; Notifications</h2>
            <p>Choose how Portal Messenger gets your attention.</p>
          </div>
        </div>
        <fieldset className="settings-options">
          <legend>Personal preferences</legend>
          {PREFERENCE_OPTIONS.map((option) => (
            <label className="settings-option" key={option.key}>
              <input
                checked={preferences[option.key]}
                onChange={(event) =>
                  setPreference(option.key, event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="settings-storage-note">
          Settings are saved on this computer.
        </p>
        <footer className="settings-actions">
          <button onClick={onClose} type="button">
            OK
          </button>
        </footer>
      </div>
    </dialog>
  );
}
