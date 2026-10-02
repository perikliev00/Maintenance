import { FormEvent, useState } from "react";
import { login, type AuthUser } from "../api/client";

type Props = {
  onLogin: (token: string, user: AuthUser) => void;
};

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("supervisor@imperial.local");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await login(email, password);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Imperial Maintenance</h1>
        <p className="muted">Housekeeping &amp; Maintenance — demo login</p>
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
          <div>reception@imperial.local</div>
          <div>housekeeper@imperial.local</div>
          <div>supervisor@imperial.local</div>
          <div>password: demo1234</div>
        </div>
      </form>
    </div>
  );
}
