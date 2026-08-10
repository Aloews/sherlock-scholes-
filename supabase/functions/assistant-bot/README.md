# assistant-bot — a private Telegram assistant

A second bot, separate from the game's. It answers one person: the account
recorded in `assistant_owner`. See the header of `index.ts` for why the two
bots share no secret, and `supabase/migrations/assistant_bot.sql` for the
tables.

## Secrets

| Secret | Who sets it | What breaks without it |
|---|---|---|
| `ASSISTANT_BOT_TOKEN` | you, from @BotFather | everything — the function 403s every update |
| `ANTHROPIC_API_KEY` | you, from console.anthropic.com | only the answers; `/start`, `/whoami`, `/reset` still work and the bot says the model is not configured |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the Functions
runtime — never set them by hand.

**There is no webhook secret to set.** It is derived as
`sha256(ASSISTANT_BOT_TOKEN)`, so install and verification cannot disagree.
The corollary: **rotating the bot token changes the webhook secret**, and
every update is rejected until you run install again.

Do not reuse `TELEGRAM_BOT_TOKEN`. That one belongs to the game's bot, which
tg-pay uses for `createInvoiceLink` and `answerPreCheckoutQuery`; overwriting
it stops Pro purchases.

## Deploy

```bash
# --no-verify-jwt: Telegram's webhook cannot send a Supabase JWT. The function
# authenticates the update itself, by the secret header.
supabase functions deploy assistant-bot --no-verify-jwt
```

## Install the webhook

The function points Telegram at itself, so the token never has to leave the
secret store:

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/assistant-bot" \
  -H 'Content-Type: application/json' \
  -d '{"action":"install"}'
```

It answers with `set_webhook`, the current `getWebhookInfo` (which contains
neither the token nor the secret), and whether the model key is present. Run it
again after any token rotation.

The URL it registers is built from `SUPABASE_URL`, never from the request
body — so this endpoint cannot be used to redirect the bot anywhere, which is
why it needs no secret of its own.

## Bind the owner

Trust on first use: **the first account to send the bot a message becomes its
owner**, and the row is then fixed. Send `/start` yourself as soon as install
succeeds. Everyone else is ignored in silence.

Check or change the binding:

```sql
select telegram_id, bound_at from assistant_owner;
delete from assistant_owner;         -- next person to write becomes the owner
```

## Commands

| Command | Effect |
|---|---|
| `/start` | greeting, and a warning if the model key is missing |
| `/whoami` | your Telegram id |
| `/reset` | delete this conversation's history |
| anything else | goes to the model, with the last 20 turns as context |

## Troubleshooting

`getWebhookInfo` is the first thing to read — `last_error_message` reports what
Telegram got back from us.

* **403 on every update** — `ASSISTANT_BOT_TOKEN` changed after install, or is
  not set. Re-run install.
* **Bot silent, no error in the webhook info** — someone else is bound as
  owner. `select * from assistant_owner`.
* **"Модель не ответила: …"** — the model call failed and the bot is quoting
  the API. A 401 is the key, a 429 is a rate limit.
