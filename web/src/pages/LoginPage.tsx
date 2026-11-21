/**
 * Email/password login; calls `onLogin` with the authenticated user on success.
 * Theme toggle is local-only and does not affect auth state.
 */
import { FormEvent, useState } from "react";
import { login, type AuthUser } from "../api/client";
import { AccessLayout } from "../components/AccessLayout";
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
    <AccessLayout theme={theme} onToggleTheme={onToggleTheme}>
      <form className="ui-form-stack" onSubmit={handleSubmit} aria-labelledby="sign-in-title">
        <div className="ui-section-heading">
          <p className="ui-eyebrow">YOUR WORKSPACE</p>
          <h1 id="sign-in-title">Welcome back</h1>
          <p className="muted">Sign in to pick up where your team left off.</p>
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
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div className="ui-access-enrollment">
          <p className="muted">
          Have an invitation code?{" "}
          </p>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              window.location.hash = "#/activate";
            }}
          >
            Activate device
          </button>
        </div>
        {/* Seed-user hint for local demos. */}
        <details className="ui-demo-help">
          <summary>Demo account details</summary>
          <div>Demo: owner / manager / supervisor / admin /</div>
          <div>housekeeper / reception / technician @meridian.local</div>
          <div>password: demo1234</div>
        </details>
      </form>
    </AccessLayout>
  );
}
