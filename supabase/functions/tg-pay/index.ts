// ============================================================================
// tg-pay — Telegram Stars payment for Sherlock Scholes Pro (one-time purchase).
//
// ONE endpoint, TWO roles, distinguished by the request itself:
//
//   1) FRONTEND invoice request — POST { action: "create_invoice", initData }
//      (no Telegram secret header). We validate the Mini App initData
//      SERVER-SIDE (via the get_user_status RPC, which checks the HMAC against
//      the bot token in Vault), then createInvoiceLink and return { link }.
//
//   2) TELEGRAM webhook update — POST carrying the header
//        X-Telegram-Bot-Api-Secret-Token == TG_WEBHOOK_SECRET
//      (set when we call setWebhook). We:
//        • pre_checkout_query   -> answerPreCheckoutQuery(ok: true)
//        • successful_payment   -> grant_pro(PAY_WEBHOOK_SECRET, payer_id)
//
// SECURITY:
//   • The secret header proves the update really came from Telegram. Without a
//     matching header we NEVER grant Pro.
//   • Pro is granted to message.from.id — the Telegram-authenticated payer —
//     never to a client-supplied id.
//   • grant_pro runs with the service_role key + pay_webhook_secret and is
//     idempotent, so a re-delivered "successful_payment" is harmless.
//   • Bot token + both secrets live in `supabase secrets`, NOT the repo.
//   • Currency is XTR (Telegram Stars): no provider_token, the price is
//     server-authoritative (env PRO_PRICE_STARS), never trusted from the client.
//
// Deploy / setWebhook: see ./README.md
// ============================================================================

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
// Echoed by Telegram on every webhook update (set via setWebhook secret_token).
const TG_WEBHOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
// The secret grant_pro requires to authorize a grant (already in prod/Vault).
const PAY_WEBHOOK_SECRET = Deno.env.get("PAY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Keep in sync with src/shared/lib/pro.ts (PRO_PRICE_STARS). Server-authoritative,
// overridable via secret so the price can change without a redeploy.
const PRO_PRICE_STARS = Number(Deno.env.get("PRO_PRICE_STARS") ?? "199");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// --- Telegram Bot API helper ---
async function tg(method: string, body: unknown): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

// --- PostgREST RPC helper (service_role) ---
async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(args),
  });
}

// Validate Mini App initData server-side and return the Telegram id (or null).
// get_user_status raises 28000 on a bad signature -> non-2xx here.
async function validateInitData(initData: string): Promise<number | null> {
  const r = await rpc("get_user_status", { p_init_data: initData });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return typeof data?.telegram_id === "number" ? data.telegram_id : null;
}

// Grant Pro to the authenticated payer. Idempotent on the DB side.
// NOTE: param names below must match the deployed grant_pro signature
//       (assumed grant_pro(p_secret text, p_telegram_id bigint)).
async function grantPro(telegramId: number): Promise<boolean> {
  const r = await rpc("grant_pro", {
    p_secret: PAY_WEBHOOK_SECRET,
    p_telegram_id: telegramId,
  });
  if (!r.ok) {
    console.error("[tg-pay] grant_pro failed", r.status, await r.text().catch(() => ""));
  }
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

  // ── Path 2: Telegram webhook update ──
  if (secretHeader !== null) {
    if (!TG_WEBHOOK_SECRET || secretHeader !== TG_WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await req.json().catch(() => null);
    if (!update) return new Response("ok"); // ignore garbage, ack to Telegram

    // Must approve the pre-checkout within seconds or the payment fails.
    if (update.pre_checkout_query) {
      await tg("answerPreCheckoutQuery", {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true,
      });
      return new Response("ok");
    }

    // Money received -> unlock Pro for the payer.
    const sp = update.message?.successful_payment;
    if (sp) {
      const payerId = update.message?.from?.id;
      if (typeof payerId === "number") {
        await grantPro(payerId);
        console.log("[tg-pay] granted Pro", payerId, sp.telegram_payment_charge_id);
      }
      return new Response("ok");
    }

    return new Response("ok"); // other update types: nothing to do
  }

  // ── Path 1: frontend invoice request ──
  const body = await req.json().catch(() => null);
  const initData: string = body?.initData ?? "";
  if (!initData) return json({ error: "missing_init_data" }, 400);

  const id = await validateInitData(initData);
  if (!id) return json({ error: "invalid_init_data" }, 401);

  const res = await tg("createInvoiceLink", {
    title: "Sherlock Scholes Pro",
    description: "Легенды, полная колода и косметика — навсегда.",
    payload: `pro:${id}`,
    currency: "XTR", // Telegram Stars — no provider_token needed
    prices: [{ label: "Pro", amount: PRO_PRICE_STARS }],
  });

  if (!res?.ok || !res.result) {
    console.error("[tg-pay] createInvoiceLink failed", JSON.stringify(res));
    return json({ error: "invoice_failed" }, 502);
  }
  return json({ link: res.result });
});
