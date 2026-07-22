import type { ReactNode } from "react";

export function OfficeWindow({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="office-title" className="messenger-window">
      <header className="window-titlebar">
        <span className="window-title" id="office-title">
          Portal Messenger: Corporate Edition
        </span>
      </header>
      {children}
    </section>
  );
}
