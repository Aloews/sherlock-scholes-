"""
Sherlock Scholes — установка оплаты Telegram Stars В ОДИН КЛИК.

Делает всё сам, ИДЕМПОТЕНТНО (повторный запуск ничего не ломает):
  1) проверяет вебхук бота ДО любых изменений — если у бота уже стоит ЧУЖОЙ
     вебхук, останавливается, ничего не тронув;
  2) берёт СУЩЕСТВУЮЩИЙ pay_webhook_secret из Vault (не ротирует! ротация
     рассинхронизировала бы Vault, функцию и Telegram); создаёт новый только
     если секрета ещё нет;
  3) приводит grant_pro к сигнатуре, которую вызывает tg-pay
     (p_secret text, p_telegram_id bigint);
  4) прописывает секреты функции ПОД ТЕМИ ИМЕНАМИ, которые index.ts реально
     читает: TELEGRAM_BOT_TOKEN, TG_WEBHOOK_SECRET, PAY_WEBHOOK_SECRET
     (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY рантайм подставляет сам);
  5) деплоит tg-pay с --no-verify-jwt (Telegram не умеет слать Supabase JWT —
     без флага гейтвей отбивает вебхук до входа в функцию);
  6) привязывает вебхук с allowed_updates=["message","pre_checkout_query"]
     (без pre_checkout_query оплата не подтверждается);
  7) проверяет, что всё на месте.

От тебя — один раз вписать 3 ключа в my_secrets.txt (рядом со скриптом) и
запустить SETUP_PAYMENT.bat. Вебхук-секрет скрипт берёт из Vault или генерит.

Только стандартная библиотека Python — ничего ставить не нужно.
"""
import io, json, os, shutil, subprocess, sys, urllib.request, urllib.error, urllib.parse, zipfile
import secrets as pysecrets

# Windows-консоль по умолчанию cp1251 — русский вывод без этого превращается
# в кракозябры (SETUP_PAYMENT.bat ставит chcp 65001, но и без него должно работать).
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS_FILE = os.path.join(HERE, "my_secrets.txt")
FN_FILE = os.path.join(HERE, "supabase", "functions", "tg-pay", "index.ts")
REQUIRED = ["SUPABASE_ACCESS_TOKEN", "PROJECT_REF", "BOT_TOKEN"]  # SERVICE_ROLE_KEY больше не нужен: рантайм функций подставляет его сам
UA = {"User-Agent": "sherlock-setup/1.1"}


def pause():
    # При запуске из автоматизации stdin может отдать EOF — это не ошибка.
    try:
        if sys.stdin.isatty():
            input("\nНажми Enter, чтобы закрыть...")
    except EOFError:
        pass


def die(msg):
    print("\n!! " + msg)
    pause()
    sys.exit(1)


def load_secrets():
    if not os.path.exists(SECRETS_FILE):
        with open(SECRETS_FILE, "w", encoding="utf-8") as f:
            f.write(
                "# Впиши значения ПОСЛЕ знака = (без кавычек, без пробелов), сохрани файл,\n"
                "# и запусти SETUP_PAYMENT.bat ещё раз. Где взять — справа.\n\n"
                "SUPABASE_ACCESS_TOKEN=# supabase.com -> аватар справа сверху -> Account -> Access Tokens -> Generate\n"
                "PROJECT_REF=# supabase.com -> проект -> Project Settings -> General -> Reference ID\n"
                "BOT_TOKEN=# @BotFather -> твой бот -> API Token\n"
            )
        die("Создал файл my_secrets.txt рядом со скриптом.\n"
            "Открой его, впиши 3 значения, сохрани и запусти SETUP_PAYMENT.bat ещё раз.")
    vals = {}
    for line in open(SECRETS_FILE, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if "=" in line:
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip()
    missing = [k for k in REQUIRED if not vals.get(k)]
    if missing:
        die("В my_secrets.txt не заполнено: " + ", ".join(missing))
    return vals


def api_sql(ref, token, query):
    """Выполнить SQL через Supabase Management API (авторизация access-токеном)."""
    url = "https://api.supabase.com/v1/projects/%s/database/query" % ref
    body = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", **UA})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        die("Management API вернул ошибку %s:\n%s\n(Проверь SUPABASE_ACCESS_TOKEN и PROJECT_REF)"
            % (e.code, e.read().decode("utf-8", "replace")))


def sql_quote(s):
    return "'" + s.replace("'", "''") + "'"


def ensure_cli():
    for cand in ("supabase", "supabase.exe"):
        p = shutil.which(cand)
        if p:
            return p
    local = os.path.join(HERE, "supabase.exe")
    if os.path.exists(local):
        return local
    print(">> качаю supabase CLI (разово, в папку проекта)...")
    rel = json.loads(urllib.request.urlopen(
        urllib.request.Request("https://api.github.com/repos/supabase/cli/releases/latest", headers=UA)).read())
    asset = next((a for a in rel["assets"] if a["name"].endswith("windows_amd64.zip")), None)
    if not asset:
        die("Не нашёл windows-сборку CLI на GitHub. Напиши мне — дам прямую ссылку.")
    data = urllib.request.urlopen(urllib.request.Request(asset["browser_download_url"], headers=UA)).read()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        zf.extract("supabase.exe", HERE)
    return local


def run_cli(cli, args, token):
    env = dict(os.environ, SUPABASE_ACCESS_TOKEN=token)
    # секреты в аргументах не печатаем — только имена
    shown = [a.split("=", 1)[0] + "=***" if "=" in a and not a.startswith("--") else a for a in args]
    print(">> supabase " + " ".join(shown))
    res = subprocess.run([cli] + args, cwd=HERE, env=env,
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.stdout:
        print(res.stdout.strip())
    if res.returncode != 0:
        die("CLI-команда упала:\n" + (res.stderr or "").strip())


def tg(token, method, params=None):
    url = "https://api.telegram.org/bot%s/%s" % (token, method)
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read())


# Тело grant_pro — ровно та сигнатура, которую вызывает tg-pay/index.ts:
# grant_pro(p_secret text, p_telegram_id bigint). Идемпотентно.
GRANT_PRO_SQL = """
create or replace function grant_pro(p_secret text, p_telegram_id bigint)
returns boolean language plpgsql security definer set search_path = public, vault as $fn$
declare ok boolean;
begin
  select exists(select 1 from vault.decrypted_secrets
                where name = 'pay_webhook_secret' and decrypted_secret = p_secret) into ok;
  if not ok then raise exception 'forbidden'; end if;
  insert into users (telegram_id, is_pro, pro_since) values (p_telegram_id, true, now())
  on conflict (telegram_id) do update set is_pro = true,
    pro_since = coalesce(users.pro_since, now());
  return true;
end $fn$;
revoke all on function grant_pro(text, bigint) from public, anon, authenticated;
grant execute on function grant_pro(text, bigint) to service_role;
"""


def main():
    print("=" * 60)
    print(" Установка оплаты Telegram Stars — один прогон")
    print("=" * 60)
    s = load_secrets()
    ref = s["PROJECT_REF"]
    access = s["SUPABASE_ACCESS_TOKEN"]
    bot = s["BOT_TOKEN"]
    fn_url = "https://%s.supabase.co/functions/v1/tg-pay" % ref

    # 0) СНАЧАЛА смотрим вебхук — до любых изменений. Чужой вебхук = стоп.
    print("\n[0/5] Проверяю текущий вебхук бота...")
    info = tg(bot, "getWebhookInfo")
    cur = (info.get("result") or {}).get("url", "")
    if cur and cur != fn_url:
        die("У бота УЖЕ стоит другой вебхук:\n    %s\n"
            "Ничего не менял (ротация секрета при чужом вебхуке сломала бы оплату).\n"
            "Пришли мне этот url — добавим оплату в существующий вебхук отдельно." % cur)
    print("      ок:", cur or "(вебхука нет — поставлю в конце)")

    # 1) Секрет: берём существующий из Vault, НЕ ротируем. Создаём только если нет.
    print("\n[1/5] Секрет pay_webhook_secret (Vault)...")
    rows = api_sql(ref, access,
                   "select decrypted_secret from vault.decrypted_secrets "
                   "where name = 'pay_webhook_secret' limit 1;")
    if rows:
        webhook_secret = rows[0]["decrypted_secret"]
        print("      уже есть в Vault — переиспользую (НЕ ротирую)")
    else:
        webhook_secret = pysecrets.token_hex(24)
        api_sql(ref, access,
                "select vault.create_secret(%s, 'pay_webhook_secret');" % sql_quote(webhook_secret))
        print("      не было — создал новый")

    # grant_pro: если существует с ДРУГИМИ именами параметров, create or replace
    # упадёт — сначала выясняем и при несовпадении пересоздаём.
    args_rows = api_sql(ref, access,
                        "select pg_get_function_arguments(oid) as args from pg_proc "
                        "where proname = 'grant_pro';")
    existing = args_rows[0]["args"] if args_rows else None
    if existing is not None and existing != "p_secret text, p_telegram_id bigint":
        print("      grant_pro существует с другой сигнатурой (%s) — пересоздаю" % existing)
        api_sql(ref, access, "drop function if exists grant_pro(text, bigint);")
    api_sql(ref, access, GRANT_PRO_SQL)
    print("      grant_pro(p_secret text, p_telegram_id bigint) — ок")

    # 2) CLI
    print("\n[2/5] Готовлю supabase CLI...")
    cli = ensure_cli()

    # какие env-имена реально читает функция — контроль соответствия шагу 3
    if os.path.exists(FN_FILE):
        import re
        names = sorted(set(re.findall(r'Deno\.env\.get\("([^"]+)"\)', open(FN_FILE, encoding="utf-8").read())))
        print("      функция читает env:", ", ".join(names) or "(не нашёл)")
    else:
        die("Не нашёл %s — запускай скрипт из КОРНЯ проекта." % FN_FILE)

    # 3) секреты функции — ИМЕНА как в index.ts. SUPABASE_URL и
    #    SUPABASE_SERVICE_ROLE_KEY рантайм подставляет сам (их ставить нельзя).
    print("\n[3/5] Прописываю секреты функции...")
    run_cli(cli, ["secrets", "set", "--project-ref", ref,
                  "TELEGRAM_BOT_TOKEN=" + bot,
                  "TG_WEBHOOK_SECRET=" + webhook_secret,
                  "PAY_WEBHOOK_SECRET=" + webhook_secret], access)

    # 4) деплой: --no-verify-jwt обязателен — Telegram не шлёт Supabase JWT.
    print("\n[4/5] Деплою функцию tg-pay (--no-verify-jwt)...")
    run_cli(cli, ["functions", "deploy", "tg-pay", "--no-verify-jwt",
                  "--project-ref", ref], access)

    # 5) вебхук: сюда доходим только если вебхука нет или он уже наш —
    #    ставим/обновляем, чтобы secret_token гарантированно совпал с Vault.
    #    allowed_updates: без pre_checkout_query Telegram не даст подтвердить оплату.
    print("\n[5/5] Привязываю Telegram-вебхук...")
    r = tg(bot, "setWebhook", {
        "url": fn_url,
        "secret_token": webhook_secret,
        "allowed_updates": json.dumps(["message", "pre_checkout_query"]),
    })
    print("      setWebhook:", "ok" if r.get("ok") else r)

    # проверка
    chk = api_sql(ref, access,
                  "select (select count(*) from pg_proc where proname='grant_pro') as grant_pro,"
                  " (select count(*) from vault.secrets where name='pay_webhook_secret') as secret;")
    info = tg(bot, "getWebhookInfo").get("result") or {}
    try:
        urllib.request.urlopen(urllib.request.Request(fn_url, headers=UA))
        fn_alive = "отвечает"
    except urllib.error.HTTPError as e:
        fn_alive = "отвечает (HTTP %s — норм: без секретного заголовка и не должна пускать)" % e.code
    except Exception as e:
        fn_alive = "НЕ отвечает: %r" % e

    print("\n" + "=" * 60)
    print("ГОТОВО.")
    print("  БД          :", json.dumps(chk, ensure_ascii=False))
    print("  Вебхук      :", info.get("url", "?"), "| pending:", info.get("pending_update_count", "?"))
    print("  Функция     :", fn_alive)
    print("Теперь открой Pro в мини-аппе и купи — is_pro выставится автоматически.")
    print("=" * 60)
    pause()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        die("Непредвиденная ошибка: %r" % e)
