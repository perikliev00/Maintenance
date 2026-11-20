import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NotificationInbox } from "../components/NotificationInbox";
import { logout, logoutAll, ROLE_LABELS, type Panel } from "../api/client";
import { StudioMark, EmptyState } from "../ui";
import { useModalLifecycle } from "../hooks/useModalLifecycle";
import type { BoardFocus } from "./boardFocus";
import { ActivePanel, AppRouting } from "./routing";
import { useAuthBootstrap } from "./useAuthBootstrap";
import { PANEL_NAMES, WORKSPACES, workspaceFor } from "./workspaces";

function WorkspaceFinder({ panels, locale, onSelect, onClose }: {
  panels: Panel[]; locale: "bg" | "en"; onSelect: (panel: Panel) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useModalLifecycle(onClose, { onCleanup: () => previous.current?.focus() });
  useEffect(() => { input.current?.focus(); }, []);
  const matches = panels.filter(panel => (PANEL_NAMES[panel].en + " " + PANEL_NAMES[panel].bg).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return createPortal(<div className="ui-dialog-backdrop" onClick={onClose}>
    <section className="ui-finder" role="dialog" aria-modal="true" aria-labelledby="finder-title" onClick={e => e.stopPropagation()}>
      <header><h2 id="finder-title">{locale === "en" ? "Find a workspace" : "Намерете раздел"}</h2><button type="button" className="ghost" onClick={onClose} aria-label="Close">×</button></header>
      <label className="ui-finder-search"><span>{locale === "en" ? "Search pages" : "Търсене на раздел"}</span><input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder={locale === "en" ? "Rooms, repairs, people…" : "Стаи, повреди, екип…"} /></label>
      <div className="ui-finder-results">{matches.map(panel => <button type="button" className="ghost" key={panel} onClick={() => onSelect(panel)}><span>{PANEL_NAMES[panel][locale]}</span><small>{workspaceFor(panel)[locale]}</small></button>)}
        {!matches.length && <p className="muted">{locale === "en" ? "No matching workspace." : "Няма намерен раздел."}</p>}</div>
    </section>
  </div>, document.body);
}

export default function App() {
  const { user, setUser, signedIn, setSignedIn, authReady, setAuthEpoch, view, setView, theme, publicSettings, panels, locale, onToggleTheme } = useAuthBootstrap();
  const [finderOpen, setFinderOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [boardFocus, setBoardFocus] = useState<BoardFocus | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const currentGroup = workspaceFor(view);
  const groups = WORKSPACES.filter(group => group.panels.some(panel => panels.includes(panel)));
  const contextPanels = currentGroup.panels.filter(panel => panels.includes(panel));
  const navigate = useCallback((panel: Panel) => {
    if (!panels.includes(panel)) return;
    setView(panel); setFinderOpen(false); setAccountOpen(false);
  }, [panels, setView]);
  const onNavigateToFocus = useCallback((panel: Panel, focus?: BoardFocus | null) => {
    if (!panels.includes(panel)) return;
    setBoardFocus(focus ?? null); navigate(panel);
  }, [panels, navigate]);
  const consumeFocus = useCallback(() => setBoardFocus(null), []);
  useEffect(() => { if (user) setSignOutError(null); }, [user?.id]);
  useEffect(() => { document.documentElement.lang = signedIn && user ? locale : "en"; }, [signedIn, user?.id, locale]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setFinderOpen(open => !open); }
      if (event.key === "Escape") setAccountOpen(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => { pageRef.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [view]);
  const finishLogout = () => { setSignedIn(false); setUser(null); setAuthEpoch(n => n + 1); };
  return <>
    {signOutError && <p role="alert" className="error banner">{signOutError}</p>}
    <AppRouting authReady={authReady} signedIn={signedIn} user={user} theme={theme} onToggleTheme={onToggleTheme} setUser={setUser} setSignedIn={setSignedIn} setView={setView} setAuthEpoch={setAuthEpoch}>
      {user && <div className={"ui-studio" + (publicSettings?.interface.density === "compact" ? " density-compact" : "")}>
        <a className="ui-skip" href="#workspace-content">{locale === "en" ? "Skip to content" : "Към съдържанието"}</a>
        <header className="ui-masthead">
          <div className="ui-wordmark"><StudioMark /><div><strong>MERIDIAN</strong><span>{locale === "en" ? "Operations studio" : "Оперативен център"}</span></div></div>
          <nav className="ui-workspace-nav" aria-label={locale === "en" ? "Workspaces" : "Работни пространства"}>
            {groups.map(group => <button type="button" key={group.id} data-workspace={group.id} className={currentGroup.id === group.id ? "active" : ""} aria-current={currentGroup.id === group.id ? "true" : undefined}
              onClick={() => { const first = group.panels.find(panel => panels.includes(panel)); if (first) navigate(first); }}>{group[locale]}</button>)}
          </nav>
          <div className="ui-masthead-tools">
            <button type="button" className="ui-find-trigger" onClick={() => setFinderOpen(true)} aria-label={locale === "en" ? "Find a workspace" : "Намерете раздел"}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><span>{locale === "en" ? "Find" : "Търсене"}</span><kbd>Ctrl K</kbd></button>
            {panels.includes("notifications") && <NotificationInbox locale={locale} active={view === "notifications"} onOpen={() => navigate("notifications")} />}
            <div className="ui-account-wrap"><button type="button" className="ui-avatar" aria-expanded={accountOpen} aria-controls="account-menu" aria-label={locale === "en" ? "Account menu" : "Профил"} onClick={() => setAccountOpen(open => !open)}>{user.fullName.split(" ").map(part => part[0]).slice(0, 2).join("")}</button>
              {accountOpen && <div id="account-menu" className="ui-account"><strong>{user.fullName}</strong><span className="muted">{locale === "en" ? user.role : ROLE_LABELS[user.role]}</span><span className="muted">{user.email}</span>
                <button type="button" className="ghost" onClick={onToggleTheme}>{theme === "dark" ? "Light" : "Dark"}</button>
                <button type="button" className="ghost" onClick={() => { void logout().finally(finishLogout); }}>Log out</button>
                <button type="button" className="ghost" onClick={() => { void logoutAll().then(finishLogout).catch(() => { setSignedIn(false); setUser(null); setSignOutError(locale === "bg" ? "Не успяхме да потвърдим излизането от всички устройства. Локалните данни са почистени." : "Could not confirm sign out on all devices. Local data has been cleared."); }); }}>Sign out everywhere</button>
              </div>}
            </div>
          </div>
        </header>
        <div className="ui-context-bar"><span className="ui-context-name">{currentGroup[locale]}</span><nav aria-label="Main">{contextPanels.map(panel => <button type="button" key={panel} data-panel={panel} aria-current={view === panel ? "page" : undefined} className={view === panel ? "active" : ""} onClick={() => navigate(panel)}>{PANEL_NAMES[panel][locale]}</button>)}</nav></div>
        <div id="workspace-content" className="ui-page-host" ref={pageRef} tabIndex={-1} data-current-panel={view}>
          {panels.includes(view) ? <ActivePanel view={view} user={user} locale={locale} publicSettings={publicSettings} panels={panels} setView={navigate} setUser={setUser} boardFocus={boardFocus} onBoardFocusConsumed={consumeFocus} onNavigateToFocus={onNavigateToFocus} />
            : <EmptyState title={locale === "en" ? "No workspaces assigned" : "Няма предоставени раздели"} description={locale === "en" ? "Your administrator can grant workspace access." : "Администраторът може да предостави достъп."} />}
        </div>
        <footer className="ui-studio-footer"><span>Meridian</span><span>{locale === "en" ? "Hotel operations, in focus." : "Хотелските операции на фокус."}</span></footer>
        {finderOpen && <WorkspaceFinder panels={panels} locale={locale} onSelect={navigate} onClose={() => setFinderOpen(false)} />}
      </div>}
    </AppRouting>
  </>;
}
