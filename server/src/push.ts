import webpush from "web-push";
import type { AppContext } from "./context.js";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export function configurePush(ctx: AppContext): void {
  webpush.setVapidDetails(ctx.config.VAPID_SUBJECT, ctx.config.VAPID_PUBLIC_KEY, ctx.config.VAPID_PRIVATE_KEY);
}

/**
 * Sends to every registered device. Payloads are end-to-end encrypted (RFC 8291), so the
 * browser vendor's push service (FCM on Android Chrome) cannot read them.
 */
export async function sendPushToAll(ctx: AppContext, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  const subs = ctx.db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions").all() as {
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 12 * 3600, urgency: "normal" },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          ctx.db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id);
          removed++;
        } else {
          ctx.log.warn({ status, err: (err as Error).message }, "push send failed");
        }
      }
    }),
  );
  return { sent, removed };
}
