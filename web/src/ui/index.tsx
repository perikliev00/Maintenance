import type { ReactNode } from "react";

/** Presentation primitives; domain state and permissions stay in their owners. */
export function Workspace({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`ui-workspace ${className}`}>{children}</main>;
}
export function WorkspaceIntro({ eyebrow, title, description, actions, children }: {
  eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  return <header className="ui-intro"><div>{eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}<h1>{title}</h1>
    {description && <p className="ui-intro-description">{description}</p>}{children}</div>{actions && <div className="ui-intro-actions">{actions}</div>}</header>;
}
export function Surface({ children, title, description, actions, className = "" }: {
  children: ReactNode; title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <section className={`ui-surface ${className}`}>{(title || actions) && <header className="ui-surface-header"><div><h2>{title}</h2>
    {description && <p className="muted">{description}</p>}</div>{actions}</header>}{children}</section>;
}
export function SectionNav<T extends string>({ label, items, value, onChange }: {
  label: string; items: readonly { id: T; label: ReactNode; description?: string }[]; value: T; onChange: (value: T) => void;
}) {
  return <nav className="ui-section-nav" aria-label={label}>{items.map(item => <button type="button" key={item.id} aria-current={value === item.id ? "page" : undefined}
    className={value === item.id ? "active" : ""} onClick={() => onChange(item.id)}><span>{item.label}</span>{item.description && <small>{item.description}</small>}</button>)}</nav>;
}
export function Metric({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return <div className="ui-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}
export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <div className="ui-empty"><span className="ui-empty-symbol" aria-hidden="true">✓</span><h2>{title}</h2>{description && <p>{description}</p>}{action}</div>;
}
/** Code-native mark, independently drawn for this experience. */
export function StudioMark({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor" />
    <path d="M8 22V10l8 8 8-8v12M16 18v6" stroke="var(--mark-ink, white)" strokeWidth="2.5" strokeLinejoin="round" /></svg>;
}
