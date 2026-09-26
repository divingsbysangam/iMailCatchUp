import { useEffect, useState } from "react";
import { api, type Status } from "../api";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../push";

export function Settings({ onSignedOut }: { onSignedOut: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    setStatus(await api.get<Status>("/api/status"));
    setPushOn(!!(await currentSubscription()));
  };
  useEffect(() => void refresh().catch((e) => setMsg((e as Error).message)), []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await refresh();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const standalone = window.matchMedia("(display-mode: standalone)").matches;

  return (
    <section className="settings">
      <header className="bar"><h1>Settings</h1></header>
      {msg && <p className="notice">{msg}</p>}

      <h2>Notifications</h2>
      {!pushSupported() ? (
        <p className="muted">This browser doesn't support push. Use Chrome on Android.</p>
      ) : (
        <>
          {!standalone && <p className="muted small">Tip: in Chrome, tap ⋮ → "Add to Home screen" / "Install app" for the best experience.</p>}
          <div className="buttons">
            {pushOn ? (
              <button onClick={() => run(disablePush, "Notifications disabled on this device.")}>Disable on this device</button>
            ) : (
              <button onClick={() => run(enablePush, "Notifications enabled on this device.")}>Enable on this device</button>
            )}
            <button disabled={!pushOn} onClick={() => run(() => api.post("/api/push/test"), "Test notification sent.")}>Send test</button>
          </div>
        </>
      )}

      <h2>Status</h2>
      {status && (
        <dl>
          <dt>Evening brief</dt>
          <dd>{status.briefTime} ({status.briefTimezone})</dd>
          <dt>Last sync</dt>
          <dd>{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "never"}</dd>
          {status.lastSyncError && (
            <>
              <dt>Last sync error</dt>
              <dd className="error">{status.lastSyncError.message}</dd>
            </>
          )}
          <dt>Folders</dt>
          <dd>{status.mailboxes.join(", ")}</dd>
          <dt>Devices with notifications</dt>
          <dd>{status.pushDevices}</dd>
        </dl>
      )}

      <h2>Session</h2>
      <div className="buttons">
        <button onClick={() => run(() => api.post("/api/auth/logout"), "").then(onSignedOut)}>Sign out</button>
        <button className="danger" onClick={() => confirm("Sign out on every device?") && run(() => api.post("/api/auth/logout-all"), "").then(onSignedOut)}>
          Sign out everywhere
        </button>
      </div>
    </section>
  );
}
