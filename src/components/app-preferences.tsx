"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export type AppPreferences = {
  interfaceSounds: boolean;
  typingSounds: boolean;
  mentionNotifications: boolean;
};

const DEFAULT_PREFERENCES: AppPreferences = {
  interfaceSounds: true,
  typingSounds: true,
  mentionNotifications: true,
};
const STORAGE_KEY = "portal-messenger:preferences:v1";

type AppPreferencesContextValue = {
  preferences: AppPreferences;
  preferencesReady: boolean;
  setPreference: <Key extends keyof AppPreferences>(
    key: Key,
    value: AppPreferences[Key],
  ) => void;
};

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(
  null,
);

function readPreferences() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<AppPreferences>;
    return {
      interfaceSounds:
        typeof parsed.interfaceSounds === "boolean"
          ? parsed.interfaceSounds
          : DEFAULT_PREFERENCES.interfaceSounds,
      typingSounds:
        typeof parsed.typingSounds === "boolean"
          ? parsed.typingSounds
          : DEFAULT_PREFERENCES.typingSounds,
      mentionNotifications:
        typeof parsed.mentionNotifications === "boolean"
          ? parsed.mentionNotifications
          : DEFAULT_PREFERENCES.mentionNotifications,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] =
    useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    setPreferences(readPreferences());
    setPreferencesReady(true);
  }, []);

  function setPreference<Key extends keyof AppPreferences>(
    key: Key,
    value: AppPreferences[Key],
  ) {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The current session still honors the choice when storage is blocked.
      }
      return next;
    });
  }

  return (
    <AppPreferencesContext.Provider
      value={{ preferences, preferencesReady, setPreference }}
    >
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error(
      "useAppPreferences must be used within AppPreferencesProvider",
    );
  }
  return context;
}
