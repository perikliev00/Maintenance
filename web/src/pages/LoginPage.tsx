import { FormEvent, useState } from "react";
import { login, type AuthUser } from "../api/client";
import { BrandMark } from "../components/BrandMark";
import type { ThemeMode } from "../theme";

type Props = {
  onLogin: (user: AuthUser) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

export function LoginPage({ onLogin, theme, onToggleTheme }: Props) {
  const [email, setEmail] = useState("owner@meridian.local");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
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
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div className="demo-hint">
          <div>Demo: owner / manager / supervisor / admin /</div>
          <div>housekeeper / reception / technician @meridian.local</div>
          <div>password: demo1234</div>
        </div>
      </form>
    </div>
  );
}
