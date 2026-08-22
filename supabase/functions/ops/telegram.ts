/* Telegram delivery for ops alerts.
 *
 * Deliberately NOT routed through the mini. Every other Telegram bot Ian owns
 * (DailyBriefing, PlaneSpotter, UPSTracker, BrainBot) runs on the mini, so none
 * of them can report the mini being dead — the 20 Aug outage went unnoticed for
 * 41 hours for exactly that reason. This path is Supabase → Telegram directly,
 * so it still works when the mini is off, asleep, or sitting at a login screen.
 *
 * Optional: with the secrets unset this is a no-op and web push carries on
 * alone, so the function never fails because a channel is not configured.
 *   supabase secrets set TELEGRAM_ALERT_BOT_TOKEN=... TELEGRAM_ALERT_CHAT_ID=...
 */
const BOT_TOKEN = Deno.env.get("TELEGRAM_ALERT_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_ALERT_CHAT_ID") ?? "";
const SEND_TIMEOUT_MS = 8000;
const MAX_MESSAGE_CHARS = 3500;

export function telegramConfigured(): boolean {
  return Boolean(BOT_TOKEN && CHAT_ID);
}

/**
 * Send one plain-text message. Never throws and never logs the token: a
 * delivery channel failing must not take the health check down with it.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;

  const timeout = AbortSignal.timeout(SEND_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: text.slice(0, MAX_MESSAGE_CHARS),
          disable_web_page_preview: true,
        }),
        signal: timeout,
      },
    );
    if (!response.ok) {
      /* Telegram puts the reason in the body; the token is only ever in the
       * URL, which is not echoed back. */
      console.error("ops: telegram send failed", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("ops: telegram send threw", error instanceof Error ? error.message : error);
    return false;
  }
}
