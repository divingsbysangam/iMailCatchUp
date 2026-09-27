import { useState, type FormEvent } from "react";
import { api } from "../api";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { password, totp });
      setPassword("");
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
      setTotp("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-head">
      <p className="eyebrow">Sign in</p>
      <h1 tabIndex={-1}>Your inbox, <em>twice a day.</em></h1>
      <p className="lede">Private to one person. You need your app password and the 6-digit code from your authenticator.</p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="code">Authenticator code</label>
          <input
            id="code"
            className="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
        {error && <p className="error-line" role="alert">{error}</p>}
        <div className="foot-actions" style={{ borderTop: 0, paddingTop: 0, marginTop: 24 }}>
          <button type="submit" className="btn signal" disabled={busy || !password || totp.length !== 6}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </section>
  );
}
