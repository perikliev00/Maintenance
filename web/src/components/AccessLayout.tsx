import type { ReactNode } from "react";
import type { ThemeMode } from "../theme";
import { StudioMark } from "../ui";

/** Original, asset-free access workspace shared by sign-in and enrollment. */
export function AccessLayout({ children, theme, onToggleTheme, enrollment = false }: {
  children: ReactNode;
  theme: ThemeMode;
  onToggleTheme: () => void;
  enrollment?: boolean;
}) {
  return (
    <main className="ui-access">
      <header className="ui-access-masthead">
        <a className="ui-wordmark" href="#" aria-label="Meridian sign in">
          <StudioMark />
          <div><strong>MERIDIAN</strong><span>Operations studio</span></div>
        </a>
        <button type="button" className="ghost" onClick={onToggleTheme}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>
      <div className="ui-access-layout">
        <section className="ui-access-intro">
          <p className="ui-eyebrow">HOTEL OPERATIONS, CONNECTED</p>
          <h2>{enrollment ? "Your team.\nYour workspace." : "A clear view.\nA better day."}</h2>
          <p>{enrollment
            ? "Connect this device to your team’s workspace and keep the day moving."
            : "Bring people, places and the work between them into one shared rhythm."}</p>
          <svg className="ui-orbit" viewBox="0 0 440 240" fill="none" aria-hidden="true">
            <ellipse cx="220" cy="120" rx="180" ry="70" stroke="currentColor" strokeWidth="1" />
            <ellipse cx="220" cy="120" rx="112" ry="110" transform="rotate(-35 220 120)" stroke="currentColor" strokeWidth="1" />
            <path d="M40 120h360M220 10v220" stroke="currentColor" strokeWidth="1" strokeDasharray="3 8" />
            <rect x="190" y="90" width="60" height="60" rx="14" fill="currentColor" />
            <path d="m207 119 9 9 17-19" stroke="var(--surface, white)" strokeWidth="4" />
            <circle cx="50" cy="120" r="9" fill="currentColor" />
            <circle cx="300" cy="39" r="9" fill="currentColor" />
            <circle cx="330" cy="175" r="9" fill="currentColor" />
          </svg>
          <div className="ui-access-principles"><span>People</span><span>Readiness</span><span>Continuity</span></div>
        </section>
        <section className="ui-access-form">{children}</section>
      </div>
      <footer className="ui-access-footer">Meridian · Housekeeping &amp; Maintenance</footer>
    </main>
  );
}
