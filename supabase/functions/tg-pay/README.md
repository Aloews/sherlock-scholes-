# tg-pay — Telegram Stars payment for Pro

Edge Function that (1) issues a Telegram Stars invoice link to the Mini App,
(2) receives Telegram payment updates, and (3) serves a Rich Message hub for the existing mini-games plus a chat-native football
quiz through Telegram Rich Messages (`sendRichMessage` + callback queries).
The quiz reuses the existing `quiz_player_round` source and keeps answer keys in
a service-role-only session table. It is not HTMLBubbles: Telegram has not
published a Bot API method for sending executable HTMLBubbles. See `index.ts`.

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
  -d 'allowed_updates=["message","pre_checkout_query","callback_query"]'
```

`allowed_updates` must include `pre_checkout_query` (to approve checkout),
`message` (to receive `successful_payment` and `/quiz`), and `callback_query`
(to process the rich quiz buttons). On the first `/quiz`, the function checks
`getWebhookInfo` and adds `callback_query` only if the existing webhook URL
matches this project's `tg-pay` endpoint. It preserves the current URL, secret,
connection limit, and IP. It refuses to change a different endpoint or a
custom-certificate webhook; in those cases update the existing webhook
manually rather than replacing it.

## Test

1. Open the Mini App → Pro screen → Buy. `openInvoice` should show the Stars
   sheet for `PRO_PRICE_STARS`.
2. Pay (test/real Stars). Telegram fires `pre_checkout_query` → we approve →
   `successful_payment` → `grant_pro` flips `is_pro`.
3. The app refetches `get_user_status`; legends + cosmetics unlock.

```sql
select telegram_id, is_pro, pro_since from users order by updated_at desc;
```

## Chat-native quiz

In a private chat with the game bot, send `/quiz`. The bot sends a structured
Telegram Rich Message with four player choices. The first answer wins; the bot
edits the same message with the result and a next-question action. The session
expires after 30 minutes. The correct answer is never embedded in callback data
or the message payload, and the service-role-only session table is protected by
RLS.

Telegram Rich Messages are structured native message blocks and callback
buttons. They do not execute arbitrary HTML/CSS/JavaScript. HTMLBubbles is a
separate experimental client feature and currently has no public Bot API send
method, so this implementation deliberately uses the supported Rich Messages
API instead of reverse-engineering a private protocol.
## Mini-game hub

In a private chat, send `/games`. The bot returns a Telegram Rich Message with
Web App buttons for the existing `quiz`, `famous`, and `squad` routes. If
Rich Messages are unavailable, the same routes are exposed through a regular
inline keyboard. The hub does not duplicate game rules or data sources: all
three routes open the existing Mini App implementations. Send `/quiz` to play
the player-guessing round entirely inside the chat.


Telegram Bot API 10.3 documents `sendRichMessage` and structured Rich Message blocks/buttons; this implementation uses that API for a chat-native quiz and `/games` menu, with standard inline-keyboard fallback. This is not arbitrary HTML/CSS/JavaScript execution: the client-side HTMLBubbles experiment remains a separate capability without a documented public bot API. Use Telegram Web Apps for custom executable interfaces.
