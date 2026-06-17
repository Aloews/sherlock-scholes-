#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
#  Sherlock Scholes - деплой оплаты Telegram Stars (Edge Function tg-pay).
#  Запуск из КОРНЯ проекта в Git Bash:   bash deploy_tg_pay.sh
#
#  Заполни 4 значения ниже - это твои секреты, их знаю только ты (я их выдумать
#  не могу). Всё остальное скрипт делает сам: достаёт CLI, прописывает секреты,
#  деплоит функцию, привязывает вебхук, проверяет.
# ============================================================================

# ─── ЗАПОЛНИ ЭТО (4 значения) ───────────────────────────────────────────────
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}"   # supabase.com -> аватар (справа сверху) -> Account -> Access Tokens -> Generate new token
PROJECT_REF="${PROJECT_REF:-}"             # supabase.com -> проект -> Project Settings -> General -> Reference ID
BOT_TOKEN="${BOT_TOKEN:-}"               # @BotFather -> твой бот -> API Token (тот же, что в Vault)
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}"        # Project Settings -> API -> service_role -> Reveal -> copy
# ────────────────────────────────────────────────────────────────────────────
# Значения выше НЕ хранятся в репозитории. Заполни my_secrets.txt (он в .gitignore)
# и подгрузи:  set -a; . ./my_secrets.txt; set +a; bash deploy_tg_pay.sh

# Вебхук-секрет: ВАЖНО - то же значение должно стоять в SQL (см. pay_webhook_secret).
# Не меняй после первого деплоя, иначе оплата не совпадёт с проверкой.
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"

export SUPABASE_ACCESS_TOKEN

# ─── 1. Достаём supabase CLI (нет - качаем бинарь, без установки в систему) ──
if command -v supabase >/dev/null 2>&1; then SUPA=supabase
elif [ -x "./supabase.exe" ]; then SUPA=./supabase.exe
else
  echo ">> supabase CLI не найден - скачиваю бинарь под Windows..."
  URL=$(curl -s https://api.github.com/repos/supabase/cli/releases/latest \
    | grep -oE '"browser_download_url":[[:space:]]*"[^"]*windows_amd64\.zip"' \
    | head -1 | sed -E 's/.*"(https[^"]+)".*/\1/')
  curl -L "$URL" -o supabase.zip
  unzip -o supabase.zip supabase.exe >/dev/null
  rm -f supabase.zip
  SUPA=./supabase.exe
fi
echo ">> CLI: $($SUPA --version)"

# ─── 2. Какие env-имена реально читает функция (контроль совпадения) ─────────
echo ">> функция tg-pay читает env:"
grep -oE 'Deno\.env\.get\("[^"]+"\)' supabase/functions/tg-pay/index.ts \
  | sed -E 's/.*\("([^"]+)"\).*/   \1/' | sort -u || true
echo "   (если имена ВЫШЕ другие - поправь левую часть в шаге 3)"

# ─── 3. Прописываем секреты функции ─────────────────────────────────────────
$SUPA secrets set --project-ref "$PROJECT_REF" \
  BOT_TOKEN="$BOT_TOKEN" \
  PAY_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"

# ─── 4. Деплоим функцию ─────────────────────────────────────────────────────
$SUPA functions deploy tg-pay --project-ref "$PROJECT_REF"

# ─── 5. Вебхук Telegram -> функция (НЕ перезаписываем существующий) ──────────
FN_URL="https://${PROJECT_REF}.supabase.co/functions/v1/tg-pay"
CUR=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")
echo ">> текущий вебхук бота: $CUR"
if echo "$CUR" | grep -q '"url":""'; then
  echo ">> ставлю вебхук на ${FN_URL}"
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${FN_URL}&secret_token=${WEBHOOK_SECRET}"
  echo
else
  echo "!! У бота УЖЕ есть вебхук (см. выше) - НЕ перезаписываю, чтобы не сломать бота."
  echo "!! Пришли мне этот url - добавим оплату в существующий вебхук отдельно."
fi

echo
echo "ГОТОВО. Проверка: открой Pro в мини-аппе -> купи -> в SQL Editor выполни:"
echo "  select telegram_id, is_pro from users order by pro_since desc nulls last limit 5;"
