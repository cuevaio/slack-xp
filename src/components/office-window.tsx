import type { ReactNode } from "react";

export function OfficeWindow({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="office-title" className="messenger-window">
      <header className="window-titlebar">
        <span className="window-title" id="office-title">
          Portal Messenger: Corporate Edition
        </span>
        <span className="window-controls">
          <button aria-hidden="true" disabled tabIndex={-1} type="button">
            _
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
          >
            <span aria-hidden="true" className="fullscreen-enter-icon">
              □
            </span>
            <span aria-hidden="true" className="fullscreen-exit-icon">
              ❐
            </span>
          </label>
          <button aria-hidden="true" disabled tabIndex={-1} type="button">
            ×
          </button>
        </span>
      </header>
      {children}
    </section>
  );
}
