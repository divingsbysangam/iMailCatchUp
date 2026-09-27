import { useEffect, useState } from "react";
import { api, type Status } from "../api";
import { IconButton } from "../lib/icons";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../push";

export function Settings({ status, onSignedOut, onChange }: { status: Status | null; onSignedOut: () => void; onChange: () => void }) {
  const [pushOn, setPushOn] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void currentSubscription().then((s) => setPushOn(!!s));
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setPushOn(!!(await currentSubscription()));
      onChange();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const synced = status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never";

  return (
    <>
      <section className="page-head">
        <p className="eyebrow">Settings</p>
        <h1 tabIndex={-1}>How your briefs arrive.</h1>
        {msg && <p className={msg.ok ? "note-line" : "error-line"} role="status">{msg.text}</p>}
      </section>

      <section className="section" aria-labelledby="set-push">
        <div className="section-head"><h2 id="set-push">Notifications on this device</h2></div>
        <dl>
          <div className="kv">
            <dt>Status</dt>
            <dd>
              {!pushSupported() ? "This browser can't receive push notifications. Use Chrome on Android." : pushOn ? "On" : "Off"}
              {pushSupported() && !standalone && <p className="coord" style={{ marginTop: 8 }}>Tip: Chrome ⋮ → Install app, for the best experience</p>}
            </dd>
          </div>
        </dl>
        {pushSupported() && (
          <div className="foot-actions">
            {pushOn ? (
              <IconButton icon="bellOff" label="Turn notifications off on this device" onClick={() => run(disablePush, "Notifications are off on this device.")} />
            ) : (
              <IconButton icon="bell" label="Turn notifications on for this device" onClick={() => run(enablePush, "Notifications are on for this device.")} />
            )}
            <IconButton icon="spark" label="Send a test notification" disabled={!pushOn} onClick={() => run(() => api.post("/api/push/test"), "Test notification sent.")} />
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="set-status">
        <div className="section-head"><h2 id="set-status">Status</h2></div>
        {status && (
          <dl>
            <div className="kv"><dt>Briefs</dt><dd>{status.briefTimes.map((b) => `${b.label} ${b.time}`).join(" · ")} ({status.briefTimezone})</dd></div>
            <div className="kv"><dt>Last sync</dt><dd>{synced}</dd></div>
            {status.lastSyncError && (
              <div className="kv"><dt>Last sync error</dt><dd><span className="error-line" style={{ display: "block", marginTop: 0 }}>{status.lastSyncError.message}</span></dd></div>
            )}
            <div className="kv"><dt>Mail</dt><dd>{status.mailboxes.join(", ")} · {status.unreadOnly ? "unread only" : "all mail"}</dd></div>
            <div className="kv">
              <dt>Archiving in iCloud</dt>
              <dd>{status.autoArchive ? `On. Brief mail is marked read and moved to “${status.archiveFolder}”.` : "Off. Nothing in iCloud is changed."}</dd>
            </div>
            <div className="kv"><dt>Devices with notifications</dt><dd>{status.pushDevices}</dd></div>
          </dl>
        )}
      </section>

      <section className="section" aria-labelledby="set-session">
        <div className="section-head"><h2 id="set-session">Session</h2></div>
        <div className="foot-actions" style={{ marginTop: 0 }}>
          <IconButton icon="signout" label="Sign out on this device" onClick={() => run(() => api.post("/api/auth/logout"), "").then(onSignedOut)} />
          <button
            type="button"
            className="btn ghost"
            onClick={() => confirm("Sign out on every device?") && run(() => api.post("/api/auth/logout-all"), "").then(onSignedOut)}
          >
            Sign out everywhere
          </button>
        </div>
      </section>
    </>
  );
}
