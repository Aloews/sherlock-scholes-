"""
Sherlock Scholes — установка оплаты Telegram Stars В ОДИН КЛИК.

Делает всё сам:
  1) накатывает в БД секрет pay_webhook_secret + функцию grant_pro (через Supabase Management API — токеном, без psql);
  2) скачивает supabase CLI (если нет), без установки в систему;
  3) прописывает секреты Edge Function;
  4) деплоит функцию tg-pay;
  5) привязывает Telegram-вебхук к функции (существующий НЕ трогает);
  6) проверяет, что всё на месте.

От тебя — один раз вписать 4 ключа в файл my_secrets.txt (рядом с этим скриптом),
и запустить SETUP_PAYMENT.bat. Вебхук-секрет скрипт генерит сам.

Только стандартная библиотека Python — ничего ставить не нужно.
"""
import io, json, os, shutil, ssl, subprocess, sys, urllib.request, urllib.error, zipfile
import secrets as pysecrets

HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS_FILE = os.path.join(HERE, "my_secrets.txt")
FN_FILE = os.path.join(HERE, "supabase", "functions", "tg-pay", "index.ts")
REQUIRED = ["SUPABASE_ACCESS_TOKEN", "PROJECT_REF", "BOT_TOKEN", "SERVICE_ROLE_KEY"]
UA = {"User-Agent": "sherlock-setup/1.0"}


def die(msg):
    print("\n!! " + msg)
    input("\nНажми Enter, чтобы закрыть...")
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
                "SERVICE_ROLE_KEY=# Project Settings -> API -> service_role -> Reveal -> copy\n"
            )
        die("Создал файл my_secrets.txt рядом со скриптом.\n"
            "Открой его, впиши 4 значения, сохрани и запусти SETUP_PAYMENT.bat ещё раз.")
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
    print(">> supabase " + " ".join(args))
    res = subprocess.run([cli] + args, cwd=HERE, env=env,
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.stdout:
        print(res.stdout.strip())
    if res.returncode != 0:
        die("CLI-команда упала:\n" + (res.stderr or "").strip())


def tg(token, method, params=""):
    url = "https://api.telegram.org/bot%s/%s%s" % (token, method, params)
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read())


GRANT_PRO_SQL = """
do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'pay_webhook_secret';
  if sid is null then
    perform vault.create_secret(%(sec)s, 'pay_webhook_secret');
  else
    perform vault.update_secret(sid, %(sec)s);
  end if;
end $$;

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
    webhook_secret = pysecrets.token_hex(24)  # генерим сами, используем везде ниже

    # 1) SQL: секрет вебхука + функция grant_pro (идемпотентно)
    print("\n[1/5] Накатываю grant_pro + секрет в БД...")
    api_sql(ref, access, GRANT_PRO_SQL % {"sec": "'" + webhook_secret + "'"})
    print("      ок")

    # 2) CLI
    print("\n[2/5] Готовлю supabase CLI...")
    cli = ensure_cli()

    # какие env-имена реально читает функция — для контроля
    if os.path.exists(FN_FILE):
        import re
        names = sorted(set(re.findall(r'Deno\.env\.get\("([^"]+)"\)', open(FN_FILE, encoding="utf-8").read())))
        print("      функция читает env:", ", ".join(names) or "(не нашёл)")
    else:
        print("      ВНИМАНИЕ: не нашёл", FN_FILE, "— положи скрипт в КОРЕНЬ проекта.")

    # 3) секреты функции
    print("\n[3/5] Прописываю секреты функции...")
    run_cli(cli, ["secrets", "set", "--project-ref", ref,
                  "BOT_TOKEN=" + bot,
                  "PAY_WEBHOOK_SECRET=" + webhook_secret,
                  "SERVICE_ROLE_KEY=" + s["SERVICE_ROLE_KEY"]], access)

    # 4) деплой
    print("\n[4/5] Деплою функцию tg-pay...")
    run_cli(cli, ["functions", "deploy", "tg-pay", "--project-ref", ref], access)

    # 5) вебхук (существующий не трогаем)
    print("\n[5/5] Привязываю Telegram-вебхук...")
    fn_url = "https://%s.supabase.co/functions/v1/tg-pay" % ref
    info = tg(bot, "getWebhookInfo")
    cur = (info.get("result") or {}).get("url", "")
    if cur and cur != fn_url:
        print("      !! У бота УЖЕ есть вебхук:", cur)
        print("      !! НЕ перезаписываю, чтобы не сломать бота.")
        print("      !! Пришли мне этот url — добавим оплату в существующий вебхук отдельно.")
    else:
        r = tg(bot, "setWebhook", "?url=%s&secret_token=%s" % (fn_url, webhook_secret))
        print("      setWebhook:", "ok" if r.get("ok") else r)

    # проверка
    chk = api_sql(ref, access,
                  "select (select count(*) from pg_proc where proname='grant_pro') as grant_pro,"
                  " (select count(*) from vault.secrets where name='pay_webhook_secret') as secret;")
    print("\n" + "=" * 60)
    print("ГОТОВО. Проверка БД:", json.dumps(chk, ensure_ascii=False))
    print("Теперь открой Pro в мини-аппе и купи — is_pro выставится автоматически.")
    print("=" * 60)
    input("\nНажми Enter, чтобы закрыть...")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        die("Непредвиденная ошибка: %r" % e)
