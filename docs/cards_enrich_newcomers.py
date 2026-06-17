"""Enrich ONLY the freshly-inserted "bare" newcomer player cards.

A newcomer is a card inserted minimally by PENDING_SQL.sql / cards_famous_insert.sql
(name, name_en, forbidden_words, active=true — everything else NULL). They have
NO players_meta row, NO wikidata_qid, and NOTHING in the on-disk caches, so the
normal cache-only / DB-only backfill scripts SILENTLY SKIP them: cards_facts_apply
needs a cached wikidata_entity, cards_tier_build needs facts+pageviews, the
continent/star SQL needs country/tier. The chain therefore MUST start with a
RESOLVE step that, for these cards ONLY, fills the caches and the first columns.

This runner does exactly that, reusing the existing logic (it imports
football_scraper/run.py and calls its functions — nothing is reimplemented):

  PHASE 1  RESOLVE (scoped to newcomers, the ONLY budgeted part)
    name -> ruwiki QID            (run.resolve_card_qid -> ruwiki_pageprops cache)
    QID  -> full claims + labels  (WikidataEnricher.entity_claims_labels
                                   -> wikidata_entity cache, what facts_apply reads)
    -> legend_career              (run._legend_career_from_entity)   [step 3]
    -> country (P27) + continent  (run.iso_for_country/continent_for_country) [1,4]
    -> photo_url (P18, from the just-fetched entity, no extra request)
    -> pageviews                  (run.PageviewsClient, separate pageviews budget)
    Wikidata/ruwiki calls share photos_budget.json; pageviews share
    pageviews_budget.json — exactly like the run.py modes. Scoping to the
    newcomer set is what stops us re-burning budget on the other ~3290 cards.

  PHASE 2  APPLY via the existing GLOBAL scripts (0 Wikidata budget, idempotent,
           so they only WRITE the newcomers now that their caches are warm):
    cards_facts_apply.py          facts + tags                       [step 2]
    cards_tier_build.py  APPLY=1  tier (reads pageviews+facts+tags)  [step 5, LAST]
    cards_wc2026_build.py APPLY=1 wc2026 tag (independent)           [step 7]
    cards_star_backfill.sql       queued into PENDING_SQL.sql        [step 6, after tier]

DRY-RUN BY DEFAULT: nothing is written and no network is touched — the resolve
phase reports, from cache only, how many newcomers are already resolvable vs.
how much budget a live run would spend, and the apply phase is only listed.
Pass --apply to actually run.

  python docs/cards_enrich_newcomers.py                 # dry-run (default)
  python docs/cards_enrich_newcomers.py --apply         # do it
  python docs/cards_enrich_newcomers.py --names "Рубен Невеш,Жуан Невеш" --apply
  python docs/cards_enrich_newcomers.py --ids 4123,4124 --apply
  python docs/cards_enrich_newcomers.py --apply --skip-downstream   # resolve only

Idempotent + resumable: every write uses an IS NULL-guarded setter (or an
explicit "column already set" check), the caches make a re-resolve free, and the
default scope (facts IS NULL) drops a card as soon as facts_apply has filled it.
A budget cap stops the run politely with progress saved; rerun next UTC day.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
sys.path.insert(0, SCRAPER)

# Load run.py as a module (same trick the other docs/cards_*.py scripts use) so
# we reuse its resolve/parse helpers instead of duplicating them.
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

from scraper.cache import FileCache  # noqa: E402
from scraper.wikidata import WikidataEnricher  # noqa: E402
from scraper.supabase_writer import CardsClient  # noqa: E402

ck = run.canonical_key

PENDING_SQL = os.path.join(HERE, "PENDING_SQL.sql")
STAR_SQL = os.path.join(HERE, "cards_star_backfill.sql")
STAR_MARKER = "[newcomers] cards_star_backfill"

# Existing GLOBAL apply scripts, in order. They are cache-only / pure-DB reads
# (0 Wikidata budget) and idempotent (PATCH only when a value changes), so a
# global run writes only the newly-warmed newcomers. env overrides per script.
DOWNSTREAM = [
    ("facts+tags  [step 2]", "cards_facts_apply.py", {}),
    ("tier        [step 5]", "cards_tier_build.py", {"APPLY": "1"}),
    ("wc2026      [step 7]", "cards_wc2026_build.py", {"APPLY": "1"}),
]

# Card columns we read once up front (so every write can be guarded in code).
SELECT_COLS = ("id,name,name_en,category,country,continent,pageviews,"
               "facts,legend_career,photo_url,tags,position_ru")


# --------------------------------------------------------------------------- #
# selection
# --------------------------------------------------------------------------- #
def _get(url, key, params):
    r = requests.get(url.rstrip("/") + "/rest/v1/cards",
                     headers={"apikey": key, "Authorization": "Bearer " + key},
                     params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def fetch_paged(url, key, extra):
    rows, off = [], 0
    while True:
        params = {"select": SELECT_COLS, "order": "id.asc",
                  "limit": 1000, "offset": off}
        params.update(extra)
        batch = _get(url, key, params)
        rows.extend(batch)
        if len(batch) < 1000:
            break
        off += 1000
    return rows


def select_newcomers(url, key, ids, names, limit):
    """The newcomer work-list.

    --ids  : exactly those card ids (server-side in.()).
    --names: any active player card whose name OR name_en canonical-matches one
             of the given names (fetched then filtered in code, so spelling /
             word order / Latin-Cyrillic differences still match — same key the
             deck dedups on).
    default: category='player' AND active AND facts IS NULL — the bare cards.
    """
    if ids:
        rows = fetch_paged(url, key, {"id": "in.({})".format(",".join(ids))})
    elif names:
        wanted = {ck(n) for n in names}
        wanted.discard("")
        rows = [
            c for c in fetch_paged(url, key,
                                   {"category": "eq.player", "active": "eq.true"})
            if ck(c.get("name")) in wanted or ck(c.get("name_en")) in wanted
        ]
    else:
        rows = fetch_paged(url, key, {"category": "eq.player",
                                      "active": "eq.true", "facts": "is.null"})
    return rows[:limit] if limit else rows


# --------------------------------------------------------------------------- #
# resolve helpers (all reuse run.py)
# --------------------------------------------------------------------------- #
def cached_qid(cache, card):
    """QID from the ruwiki_pageprops cache only (no network) — used by dry-run."""
    for title in run.cards_photos_candidates(card):
        info = cache.get("ruwiki_pageprops", title)
        if info and info.get("qid") and not info.get("disambig"):
            return info["qid"]
    return None


def p18_url(entity, cfg):
    """Commons photo URL from the entity's P18 claim (already fetched — free)."""
    photos = cfg.get("photos", {})
    for st in (entity.get("claims", {}) or {}).get("P18", []):
        try:
            v = st["mainsnak"]["datavalue"]["value"]
        except (KeyError, TypeError):
            continue
        if isinstance(v, str) and v.strip():
            return run.commons_filepath_url(
                v.strip(), photos.get("width", 256), photos.get(
                    "filepath_base",
                    "https://commons.wikimedia.org/wiki/Special:FilePath"))
    return None


def country_from_p27(cache, wikidata, wd_budget, qid):
    """Country label via Wikidata P27, mirroring run.run_cards_country's legend
    fallback: prefer a P27 whose label maps to an ISO/continent; else the first
    label. Manual budget.consume() on cache miss (WikidataEnricher takes no
    budget), same as run_cards_country / run_cards_legend_career."""
    if cache.get("wikidata_p27", qid) is None:
        wd_budget.consume()
    country = None
    for cqid in wikidata.claim_item_ids(qid, "P27"):
        if cache.get("wikidata_label_en", cqid) is None:
            wd_budget.consume()
        label = wikidata.label_en_for_qid(cqid)
        if run.iso_for_country(label) or run.continent_for_country(label):
            return label
        country = country or label
    return country


def pageviews_for(pv_client, card, start, end):
    """ruwiki views for the exact name then '(футболист)', else discounted
    enwiki views by name_en — same fallback ladder as run.run_cards_pageviews."""
    name = (card.get("name") or "").strip()
    for art in [name] + ["{} {}".format(name, v)
                         for v in run.CARDS_PV_VARIANTS.get("player", [])]:
        if not art:
            continue
        res = pv_client.views_for_window(run.PROJECT_RU, art, start, end)
        if res["found"]:
            return res["views"], "ru «{}»".format(art)
    name_en = (card.get("name_en") or "").strip()
    if name_en:
        res = pv_client.views_for_window(run.PROJECT_EN, name_en, start, end)
        if res["found"]:
            return (int(round(res["views"] * run.EN_PAGEVIEWS_DISCOUNT)),
                    "enwiki x{} «{}»".format(run.EN_PAGEVIEWS_DISCOUNT, name_en))
    return None, None


# --------------------------------------------------------------------------- #
# phase 1 — resolve
# --------------------------------------------------------------------------- #
def resolve_phase(cards, cfg, url, key, dry_run):
    cache = FileCache(os.path.join(SCRAPER, "cache"), cfg["cache"]["enabled"])
    pv = cfg["pageviews"]
    wd_budget = run.WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, "cache", "photos_budget.json"))
    pv_budget = run.WikimediaBudget(
        pv.get("daily_request_budget", 5000),
        os.path.join(SCRAPER, "cache", "pageviews_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = run.WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), wd_budget)
    pv_client = run.PageviewsClient(pv, cache, pv_budget)
    cards_client = CardsClient(url, key)
    season = int(cfg.get("season", 2023))
    start, end = run.season_window(season, pv.get("window", {}))

    n = len(cards)
    print("=" * 64)
    print("PHASE 1 — RESOLVE newcomers ({})".format(
        "DRY-RUN, cache-only, no network/writes" if dry_run
        else "LIVE, fills caches + columns"))
    print("=" * 64)
    print("newcomers        : {}".format(n))
    print("Wikidata budget  : {}/{} (UTC {}) — photos_budget.json".format(
        wd_budget.used, wd_budget.limit, wd_budget.date))
    print("pageviews budget : {}/{} (UTC {}) — pageviews_budget.json".format(
        pv_budget.used, pv_budget.limit, pv_budget.date))
    print("pageviews window : {} .. {} (season {})".format(
        start.isoformat(), end.isoformat(), season))
    print("=" * 64, flush=True)

    counts = {k: 0 for k in ("resolved", "no_qid", "legend_career", "country",
                             "continent", "photo", "pageviews", "errors",
                             "cached", "need_network")}
    capped = False

    if dry_run:
        # Cache-only: report what is already resolvable and the live cost.
        for idx, card in enumerate(cards, 1):
            qid = cached_qid(cache, card)
            label = card.get("name") or "id={}".format(card.get("id"))
            if not qid:
                counts["need_network"] += 1
                print("[{}/{}] {} — нет в кеше (live: ~ruwiki+entity+labels+P27 "
                      "запросов)".format(idx, n, label))
                continue
            entity_cached = cache.get("wikidata_entity", "ru,en|" + qid) is not None
            counts["cached"] += 1
            print("[{}/{}] {} — QID {} в кеше{}".format(
                idx, n, label, qid,
                "" if entity_cached else " (entity ещё нет — 1 запрос)"))
        print("-" * 64)
        print("в кеше (QID известен): {}".format(counts["cached"]))
        print("нужен сетевой резолв : {}".format(counts["need_network"]))
        print("Оценка бюджета Wikidata: ~{} запросов в худшем случае "
              "(до ~4-5 на новичка без кеша)".format(
                  counts["need_network"] * 5))
        print("DRY-RUN — ничего не записано, сеть не тронута.")
        return counts, capped

    for idx, card in enumerate(cards, 1):
        label = card.get("name") or "id={}".format(card.get("id"))
        did = []
        try:
            qid, title, _ = run.resolve_card_qid(
                resolver, card, run.cards_photos_candidates(card))
            if not qid:
                counts["no_qid"] += 1
                print("[{}/{}] {} — SKIP: QID не найден (останется common/«Прочие»)"
                      .format(idx, n, label), flush=True)
                continue
            counts["resolved"] += 1

            # entity (claims+labels) -> wikidata_entity cache (facts_apply reads it)
            if cache.get("wikidata_entity", "ru,en|" + qid) is None:
                wd_budget.consume()
            entity = wikidata.entity_claims_labels(qid)
            refs = run._referenced_qids(entity)
            if [q for q in dict.fromkeys(refs)
                    if cache.get("wikidata_labels", q) is None]:
                wd_budget.consume()
            labels = wikidata.labels_for_qids(refs)

            # legend_career (step 3) — guarded IS NULL
            career = run._legend_career_from_entity(entity, labels)
            if career and card.get("legend_career") is None:
                cards_client.set_card_legend_career(card["id"], career)
                counts["legend_career"] += 1
                did.append("legend_career")

            # country (step 1) + continent (step 4) from P27
            country = country_from_p27(cache, wikidata, wd_budget, qid)
            if country:
                cont = run.continent_for_country(country)
                iso = run.iso_for_country(country)
                if cont and card.get("continent") is None:
                    cards_client.set_card_continent(card["id"], cont)
                    counts["continent"] += 1
                    did.append("continent={}".format(cont))
                if iso and card.get("country") is None:
                    cards_client.set_card_country(card["id"], iso)
                    counts["country"] += 1
                    did.append("country={}".format(iso))

            # photo (P18 from the entity we already have — no extra request)
            if card.get("photo_url") is None:
                url2 = p18_url(entity, cfg)
                if url2:
                    cards_client.set_card_photo(card["id"], url2)
                    counts["photo"] += 1
                    did.append("photo")

            # pageviews (separate budget)
            if card.get("pageviews") is None:
                views, via = pageviews_for(pv_client, card, start, end)
                if views is not None:
                    cards_client.set_card_pageviews(card["id"], views)
                    counts["pageviews"] += 1
                    did.append("pv={} ({})".format(views, via))

            print("[{}/{}] {} — QID {} | {}".format(
                idx, n, label, qid, ", ".join(did) or "ничего нового"),
                flush=True)

        except RuntimeError as exc:
            # Daily budget cap — stop politely, everything already PATCHed stays.
            print("[{}/{}] {} — БЮДЖЕТ исчерпан: {}. Прогресс сохранён, "
                  "повторите завтра (UTC).".format(idx, n, label, exc), flush=True)
            capped = True
            break
        except Exception as exc:  # noqa: BLE001 — log, keep going
            counts["errors"] += 1
            print("[{}/{}] {} — ошибка, пропуск: {}".format(
                idx, n, label, exc), flush=True)
            continue

    print("-" * 64)
    print("RESOLVE summary: resolved {resolved}, no_qid {no_qid}, "
          "legend_career {legend_career}, country {country}, continent "
          "{continent}, photo {photo}, pageviews {pageviews}, errors {errors}"
          .format(**counts))
    print("Wikidata budget : {}/{} | pageviews budget : {}/{}".format(
        wd_budget.used, wd_budget.limit, pv_budget.used, pv_budget.limit))
    return counts, capped


# --------------------------------------------------------------------------- #
# phase 2 — apply (existing global scripts) + star SQL queue
# --------------------------------------------------------------------------- #
def run_downstream(dry_run, skip):
    print("\n" + "=" * 64)
    print("PHASE 2 — APPLY (global idempotent scripts; only newcomers change)")
    print("=" * 64)
    if skip:
        print("--skip-downstream: пропускаю facts/tier/wc2026/star.")
        return
    if dry_run:
        for label, script, env in DOWNSTREAM:
            extra = " ".join("{}={}".format(k, v) for k, v in env.items())
            print("  would run: {:<22} {} {}".format(
                label, (extra + " ") if extra else "", script))
        print("  would queue: star backfill [step 6] -> PENDING_SQL.sql")
        return

    for label, script, env in DOWNSTREAM:
        path = os.path.join(HERE, script)
        print("\n>>> {} : {}".format(label, script), flush=True)
        proc_env = dict(os.environ)
        proc_env.update(env)
        rc = subprocess.run([sys.executable, path], env=proc_env).returncode
        if rc != 0:
            print("  [warn] {} exited with code {} — продолжаю".format(script, rc))


def queue_star_sql(dry_run, skip):
    """Append cards_star_backfill.sql to PENDING_SQL.sql (step 6, after tier),
    per the project's SQL-queue convention — never executed here. Idempotent:
    skipped if the marker is already in the queue."""
    if skip:
        return
    pending = ""
    if os.path.exists(PENDING_SQL):
        with open(PENDING_SQL, encoding="utf-8") as fh:
            pending = fh.read()
    if STAR_MARKER in pending:
        print("\nstar backfill уже в очереди PENDING_SQL.sql — пропуск.")
        return
    if dry_run:
        print("\n(dry-run) star backfill НЕ добавлен в PENDING_SQL.sql.")
        return
    with open(STAR_SQL, encoding="utf-8") as fh:
        star = fh.read()
    today = datetime.date.today().isoformat()
    section = (
        "\n\n-- ============================================================\n"
        "-- {date} — {marker} (после tier; новичкам нужен tier из бэкфилла)\n"
        "-- Источник: docs/cards_star_backfill.sql. Глобальный идемпотентный\n"
        "-- UPDATE (ставит 'star' только где его нет). Безопасно повторять.\n"
        "-- ============================================================\n"
        "{sql}\n"
    ).format(date=today, marker=STAR_MARKER, sql=star.strip())
    with open(PENDING_SQL, "a", encoding="utf-8") as fh:
        fh.write(section)
    print("\nstar backfill [step 6] добавлен в PENDING_SQL.sql "
          "(выполнить в дневном батче после прогона tier).")


# --------------------------------------------------------------------------- #
def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (football_scraper/.env)")

    ap = argparse.ArgumentParser(
        description="Enrich only the freshly-added bare newcomer player cards.")
    ap.add_argument("--apply", action="store_true",
                    help="Actually write / run. DEFAULT is dry-run (no writes, "
                         "no network).")
    ap.add_argument("--names", default=None,
                    help="Comma-separated names; matched (canonical) on name or "
                         "name_en. Overrides the default facts-IS-NULL scope.")
    ap.add_argument("--ids", default=None,
                    help="Comma-separated card ids. Overrides the default scope.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Process at most N newcomers (smoke test).")
    ap.add_argument("--skip-downstream", dest="skip_downstream",
                    action="store_true",
                    help="Run only PHASE 1 (resolve); skip facts/tier/wc2026/star.")
    args = ap.parse_args()
    dry_run = not args.apply

    ids = [s.strip() for s in args.ids.split(",") if s.strip()] if args.ids else None
    names = [s.strip() for s in args.names.split(",") if s.strip()] if args.names else None

    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))

    scope = ("ids={}".format(ids) if ids else
             "names={}".format(names) if names else
             "category='player' AND active AND facts IS NULL")
    print("Scope: {}{}".format(scope, " (limit {})".format(args.limit)
                                if args.limit else ""))
    cards = select_newcomers(url, key, ids, names, args.limit)
    if not cards:
        print("Новичков по этому скоупу не найдено — нечего обогащать.")
        return

    counts, capped = resolve_phase(cards, cfg, url, key, dry_run)

    # The global apply scripts read facts/pageviews that PHASE 1 just warmed; if
    # the budget capped mid-resolve, still apply what landed (idempotent), but
    # warn that the resolve is partial.
    if capped:
        print("\n[!] PHASE 1 остановлен на лимите бюджета — обогащено частично. "
              "Допрогоните завтра; PHASE 2 ниже всё равно применит готовое.")

    run_downstream(dry_run, args.skip_downstream)
    queue_star_sql(dry_run, args.skip_downstream)

    # ---- final summary ----------------------------------------------------
    print("\n" + "=" * 64)
    print("ИТОГО ({})".format("DRY-RUN — плана, без записи" if dry_run else "LIVE"))
    print("=" * 64)
    print("новичков в скоупе   : {}".format(len(cards)))
    if dry_run:
        print("  QID уже в кеше    : {}".format(counts["cached"]))
        print("  нужен резолв      : {}".format(counts["need_network"]))
        print("Запусти с --apply, чтобы выполнить РЕЗОЛВ + apply-скрипты.")
    else:
        print("  обогащено (QID)   : {}".format(counts["resolved"]))
        print("  legend_career     : {}".format(counts["legend_career"]))
        print("  country / continent: {} / {}".format(
            counts["country"], counts["continent"]))
        print("  photo / pageviews : {} / {}".format(
            counts["photo"], counts["pageviews"]))
        print("  БЕЗ QID -> «Прочие»/common: {} "
              "(нет ruwiki-статьи под этим именем — facts/tier останутся "
              "пустыми; добавь имя/проверь написание вручную)".format(
                  counts["no_qid"]))
        if not args.skip_downstream:
            print("  facts/tags, tier, wc2026: применены глобальными скриптами "
                  "(идемпотентно — тронуты только новички).")
            print("  star [step 6]     : добавлен в PENDING_SQL.sql (дневной батч).")
    print("=" * 64)


if __name__ == "__main__":
    main()
