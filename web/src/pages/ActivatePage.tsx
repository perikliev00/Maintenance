/**
 * Device/invitation activation: redeems invite code with optional password and
 * device fingerprint. Prefills code from the URL hash query (`?code=`).
 */
import { FormEvent, useMemo, useState } from "react";
import {
  deviceFingerprint,
  redeemInvitation,
  type AuthUser,
} from "../api/client";
import { AccessLayout } from "../components/AccessLayout";
import type { ThemeMode } from "../theme";

type Props = {
  onActivated: (user: AuthUser) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBackToLogin: () => void;
};

/** Read invitation code from `#...?...code=...` hash query. */
function readCodeFromHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  const qIndex = hash.indexOf("?");
  // No query segment → empty code (user types it).
  if (qIndex < 0) return "";
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return (params.get("code") ?? "").trim();
}

/** Invite redeem UI; binds a device fingerprint on success. */
export function ActivatePage({
  onActivated,
  theme,
  onToggleTheme,
  onBackToLogin,
}: Props) {
  // Prefill once from the hash so shared activate links land with the code filled.
  const initialCode = useMemo(() => readCodeFromHash(), []);
  // Local React state.
  const [code, setCode] = useState(initialCode);
  // Local React state.
  const [password, setPassword] = useState("");
  // Local React state.
  const [confirm, setConfirm] = useState("");
  // Local React state.
  const [deviceLabel, setDeviceLabel] = useState(() => {
    // Coarse device label for the invitations devices table.
    const ua = navigator.userAgent;
    if (/Mobile|Android|iPhone/i.test(ua)) return "Phone";
    return "Browser";
  });
  // Local React state.
  const [error, setError] = useState<string | null>(null);
  // Local React state.
  const [loading, setLoading] = useState(false);

  /** Validate password rules, redeem invite, then hand user to the shell. */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Optional password — when set, enforce length + confirm match.
    if (password && password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    // Try block for fallible work.
    try {
      const data = await redeemInvitation({
        code: code.trim(),
        password: password || undefined,
        deviceLabel: deviceLabel.trim() || "Device",
        fingerprint: deviceFingerprint(),
      });
      // Clear the activate hash so routing does not bounce back here.
      window.location.hash = "";
      onActivated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AccessLayout theme={theme} onToggleTheme={onToggleTheme} enrollment>
      <form className="ui-form-stack" onSubmit={handleSubmit} aria-labelledby="activate-title">
        <div className="ui-section-heading">
          <p className="ui-eyebrow">JOIN YOUR TEAM</p>
          <h1 id="activate-title">Activate device</h1>
          <p className="muted">Enter your invitation code and name this device.</p>
        </div>
        <fieldset>
          <legend>Workspace invitation</legend>
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
        </fieldset>
        <fieldset>
          <legend>Account access</legend>
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
        {/* Render branch: error && <div className="error">error</div> */}
        </fieldset>
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={loading}>
          {/* Render branch: loading ? "Activating…" : "Activate" */}
          {loading ? "Activating…" : "Activate"}
        </button>
        <button type="button" className="ghost" onClick={onBackToLogin}>
          Back to sign in
        </button>
      </form>
    </AccessLayout>
  );
}
