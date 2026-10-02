import { FormEvent, useMemo, useState } from "react";
import {
  deviceFingerprint,
  redeemInvitation,
  type AuthUser,
} from "../api/client";
import { BrandMark } from "../components/BrandMark";
import type { ThemeMode } from "../theme";

type Props = {
  onActivated: (user: AuthUser) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBackToLogin: () => void;
};

function readCodeFromHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  const qIndex = hash.indexOf("?");
  if (qIndex < 0) return "";
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return (params.get("code") ?? "").trim();
}

export function ActivatePage({
  onActivated,
  theme,
  onToggleTheme,
  onBackToLogin,
}: Props) {
  const initialCode = useMemo(() => readCodeFromHash(), []);
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deviceLabel, setDeviceLabel] = useState(() => {
    const ua = navigator.userAgent;
    if (/Mobile|Android|iPhone/i.test(ua)) return "Phone";
    return "Browser";
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password && password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const data = await redeemInvitation({
        code: code.trim(),
        password: password || undefined,
        deviceLabel: deviceLabel.trim() || "Device",
        fingerprint: deviceFingerprint(),
      });
      window.location.hash = "";
      onActivated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed");
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
            <h1>Activate device</h1>
            <p className="muted">Enter your invitation code</p>
          </div>
        </div>
        <label>
          Invitation code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="one-time-code"
            required
            placeholder="ABCD-EFGH"
          />
        </label>
        <label>
          Device label
          <input
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
            required
          />
        </label>
        <label>
          Password{" "}
          <span className="muted">(required for first activation)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Activating…" : "Activate"}
        </button>
        <button type="button" className="ghost" onClick={onBackToLogin}>
          Back to sign in
        </button>
      </form>
    </div>
  );
}
