/**
 * Email/password login; calls `onLogin` with the authenticated user on success.
 * Theme toggle is local-only and does not affect auth state.
 */
import { FormEvent, useState } from "react";
import { login, type AuthUser } from "../api/client";
import { BrandMark } from "../components/BrandMark";
import type { ThemeMode } from "../theme";

type Props = {
  onLogin: (user: AuthUser) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

/**
 * Standalone login screen with demo seed credentials prefilled.
 * On success, parent binds identity via `onLogin`.
 */
export function LoginPage({ onLogin, theme, onToggleTheme }: Props) {
  // Demo defaults for local seed users (see hint under the form).
  const [email, setEmail] = useState("owner@meridian.local");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Password login; parent binds identity + bumps authEpoch via onLogin.
   * Clears prior error and shows a busy state for the submit button.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Exchange credentials for session + user payload.
      const data = await login(email, password);
      onLogin(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      {/* Theme toggle outside the card (does not submit the form). */}
      <button
        type="button"
        className="ghost login-theme-toggle"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? "Light" : "Dark"}
      </button>
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <BrandMark size={44} />
          <div className="login-brand-text">
            <h1>Meridian</h1>
            <p className="muted">Housekeeping &amp; Maintenance</p>
          </div>
        </div>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {/* Inline auth error above the submit button. */}
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        {/* Seed-user hint for local demos. */}
        <div className="demo-hint">
          <div>Demo: owner / manager / supervisor / admin /</div>
          <div>housekeeper / reception / technician @meridian.local</div>
          <div>password: demo1234</div>
        </div>
      </form>
    </div>
  );
}
