# assistant-bot — a private Telegram assistant

A second bot, separate from the game's. It answers one person: the account
recorded in `assistant_owner`. See the header of `index.ts` for why the two
bots share no secret, and `supabase/migrations/assistant_bot.sql` for the
tables.

## Secrets

| Secret | Who sets it | What breaks without it |
|---|---|---|
| `ASSISTANT_BOT_TOKEN` | you, from @BotFather | everything — the function 403s every update |
| `ANTHROPIC_API_KEY` | you, from console.anthropic.com | Claude. Gemini still answers if its key is set |
| `GEMINI_API_KEY` | you, from aistudio.google.com | Gemini. Claude still answers if its key is set |
| `GEMINI_MODEL` | optional; defaults to `gemini-2.5-flash` | nothing — until Google retires that name, and then everything Gemini, as a 404. `/models` lists what the key really sees |

With neither model key the bot still answers `/start`, `/whoami`, `/model`,
`/models` and `/reset`, and names the secret that is missing.

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
| `/start` | greeting, plus which model answers and which keys are missing |
| `/model` | what is running now, and what else is on offer |
| `/model claude` / `/model gemini` | switch, stored in `assistant_owner.model` |
| `/models` | ask the providers what these keys can actually see |
| `/repo` | what it can see: the repository, the database, CI |
| `/usage` | tokens spent so far, per model |
| `/whoami` | your Telegram id |
| `/reset` | delete this conversation's history |
| anything else | goes to the chosen model, with the last 20 turns as context |

## What it can see

Asked "is the test setup in order", an assistant with no access can only say
so — honest and useless. It has four tools, and both models reach them through
their own calling conventions.

| Tool | Reaches | As |
|---|---|---|
| `list_files`, `read_file` | this repository | anonymously — it is public |
| `query_db` | the live database | **the anon key**, i.e. what a player sees |
| `ci_status` | GitHub Actions runs | anonymously |

**It can change nothing.** No commit, no write, no CI re-run — and the system
prompt says so, because a model that cannot act but implies it did is worse
than one that never had access.

### Why `query_db` uses the anon key and not the service role

The function already holds the service role for its own two tables, and that
key bypasses RLS entirely. Handing it to a tool the *model* drives would mean
the model's mistakes — and anything that talks its way into the model — reach
every row in the project, including this conversation and the players' rows.

As anon it sees the game's own public surface and nothing else, and that is a
property of Postgres rather than of an allowlist someone remembered to write.
Measured against production:

| Table | anon |
|---|---|
| `cards` | 200, 3809 rows |
| `assistant_chat`, `assistant_owner`, `assistant_repo_tree` | `42501` |
| `users`, `fixture_odds` | `42501` |

The key is injected by the Functions runtime as `SUPABASE_ANON_KEY`, so there
is nothing to configure, and it is public by construction — the same key ships
in the browser bundle.

**No credential is involved.** The repo is public: contents come from
`raw.githubusercontent.com`, the file list from the GitHub trees API. Point it
elsewhere with `ASSISTANT_REPO` / `ASSISTANT_BRANCH` — a private repo would
need a token, which this deliberately does not have.

Three limits, each with a reason:

| Limit | Value | Why |
|---|---|---|
| File list cache | 1 hour | The trees API allows 60 anonymous requests an hour **per IP**, and an Edge Function shares its IP. Uncached, the tool works until a neighbour is busy |
| File contents cache | none | A stale file read back as current is exactly the lie this bot must not tell, and raw.githubusercontent has no ceiling worth managing |
| Tool rounds per question | 8 | The cost ceiling. Without it a confused model reads the whole repository one file at a time, and you find out from the invoice |

Hitting the round ceiling is reported, not hidden — an answer that stopped
because it ran out of budget is a different thing from one that finished.

## The two models

| | Claude Opus 5 | Gemini Flash |
|---|---|---|
| For | analysis, code, anything worth re-reading | short questions, quick lookups |
| Thinking | adaptive, low effort | **off** (`thinkingBudget: 0`) |

**What makes Flash cheap is `thinkingBudget: 0`, not the name.** Flash thinks by
default and bills for it, so a "Flash" that was never told to stop is the same
money for a smaller model. That field is also the one most likely to be
rejected by a future model, and a rejection costs the whole answer — so a 400
that names it is retried once without it, and the log says which happened.

A stored choice is a preference, not a promise: if its key is removed, the bot
answers with the other model **and says so** rather than going quiet. `/model X`
refuses to store a choice whose key is missing, for the same reason.

## Troubleshooting

`getWebhookInfo` is the first thing to read — `last_error_message` reports what
Telegram got back from us.

* **403 on every update** — `ASSISTANT_BOT_TOKEN` changed after install, or is
  not set. Re-run install.
* **Bot silent, no error in the webhook info** — someone else is bound as
  owner. `select * from assistant_owner`.
* **"… не ответила: …"** — the model call failed and the bot is quoting the
  API verbatim. A 401 is the key, a 429 is a rate limit, a 404 from Google is
  a retired model name — run `/models` and set `GEMINI_MODEL` to one it lists.
