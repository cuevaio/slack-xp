import type { ReactNode } from "react";

export function OfficeWindow({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="office-title" className="messenger-window">
      <header className="window-titlebar">
        <span className="window-title" id="office-title">
          Portal Messenger: Corporate Edition
        </span>
        <span className="window-controls">
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
        </span>
      </header>
      {children}
    </section>
  );
}
