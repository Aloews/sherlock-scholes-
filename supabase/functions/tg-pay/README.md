# tg-pay — Telegram Stars payment for Pro

Edge Function that (1) issues a Telegram Stars invoice link to the Mini App and
(2) receives the Telegram payment webhook and flips `users.is_pro` via the
`grant_pro` RPC. See the header comment in `index.ts` for the full flow.

## Secrets (NEVER commit these)

The function reads everything from `supabase secrets`:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN="123456:your-bot-token"
supabase secrets set TG_WEBHOOK_SECRET="$(openssl rand -hex 32)"   # echoed in the webhook header
supabase secrets set PAY_WEBHOOK_SECRET="<same value as the DB pay_webhook_secret>"
# Optional — defaults to 199, keep in sync with src/shared/lib/pro.ts:
supabase secrets set PRO_PRICE_STARS="199"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
Supabase Functions runtime — do not set them by hand.

> `grant_pro(pay_webhook_secret, telegram_id)` and the `pay_webhook_secret` are
> already deployed to prod. `index.ts` calls it with the named params
> `p_secret` / `p_telegram_id` — if the deployed signature differs, adjust the
> arg names in `grantPro()`.

## Deploy

```bash
# --no-verify-jwt: Telegram's webhook cannot send a Supabase JWT, and initData
# is validated by the function itself.
supabase functions deploy tg-pay --no-verify-jwt
```

## Wire the webhook (does NOT clobber an existing bot)

If the bot already has a webhook/handler, **add** payment handling there instead
of overwriting it. If this function IS the bot's webhook, point Telegram at it
with the same secret you set above:

```bash
FN_URL="https://<project-ref>.functions.supabase.co/tg-pay"
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=${FN_URL}" \
  -d "secret_token=<TG_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","pre_checkout_query"]'
```

`allowed_updates` must include `pre_checkout_query` (to approve checkout) and
`message` (to receive `successful_payment`).

## Test

1. Open the Mini App → Pro screen → Buy. `openInvoice` should show the Stars
   sheet for `PRO_PRICE_STARS`.
2. Pay (test/real Stars). Telegram fires `pre_checkout_query` → we approve →
   `successful_payment` → `grant_pro` flips `is_pro`.
3. The app refetches `get_user_status`; legends + cosmetics unlock.

```sql
select telegram_id, is_pro, pro_since from users order by updated_at desc;
```
