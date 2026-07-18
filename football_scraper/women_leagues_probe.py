"""READ-ONLY probe: does API-Football carry women's football, with minutes?

Spends ~6-10 free-tier requests through the SAME budgeted client as the
scraper (so it respects the 100/day cap). Run after the daily reset.

  1. /leagues?search=women  -> women's leagues (id, country, season span).
  2. for 1-2 top leagues (England WSL, a Spanish one): take the latest
     season, grab one team via /teams, then /players?team&season and check
     whether games.minutes is actually populated.

Prints a verdict: worth collecting women, or empty.
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402
from scraper.api_football import ApiFootballClient, RateLimiter, RequestBudget  # noqa: E402
from scraper.cache import FileCache  # noqa: E402
from scraper.config import load_config, require_env  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))


def main():
    load_dotenv(os.path.join(BASE, ".env"))
    cfg = load_config(os.path.join(BASE, "config.json"))
    api_key = require_env("FOOTBALL_API_KEY")
    cache = FileCache(os.path.join(BASE, cfg["cache"]["dir"]), cfg["cache"]["enabled"])
    budget = RequestBudget(cfg["rate_limit"]["daily_request_budget"],
                           os.path.join(BASE, cfg["cache"]["dir"], "budget.json"))
    client = ApiFootballClient(cfg["base_url"], api_key, cache,
                               RateLimiter(cfg["rate_limit"]["min_pause_seconds"]),
                               cfg["retry"], budget)

    print("=" * 64)
    print("WOMEN'S FOOTBALL PROBE (free tier, budget {}/{})".format(
        budget.used, budget.limit))
    print("=" * 64)

    leagues = client.get("leagues", {"search": "women"}).get("response") or []
    print("Найдено женских лиг: {}".format(len(leagues)))
    rows = []
    for item in leagues:
        lg = item.get("league") or {}
        country = (item.get("country") or {}).get("name")
        seasons = [s.get("year") for s in (item.get("seasons") or [])]
        rows.append((lg.get("id"), lg.get("name"), country, seasons))
    for lid, name, country, seasons in rows[:40]:
        span = "{}–{}".format(min(seasons), max(seasons)) if seasons else "?"
        print("  [{}] {} ({}) сезоны {}".format(lid, name, country, span))

    # Pick a couple to test minutes on: prefer England WSL / Spain.
    def pick(*needles):
        for lid, name, country, seasons in rows:
            blob = "{} {}".format(name, country).lower()
            if all(nd in blob for nd in needles) and seasons:
                return lid, name, max(seasons)
        return None

    targets = [t for t in (pick("women", "england"), pick("women", "spain"),
                           pick("super league", "england")) if t]
    print("\n--- проверка minutes ---")
    for lid, name, season in targets:
        teams = client.get("teams", {"league": lid, "season": season}).get("response") or []
        if not teams:
            print("  {} ({}/{}): /teams пусто".format(name, lid, season))
            continue
        team_id = (teams[0].get("team") or {}).get("id")
        team_nm = (teams[0].get("team") or {}).get("name")
        pl = client.get("players", {"team": team_id, "season": season}).get("response") or []
        with_min = 0
        sample = []
        for e in pl:
            for st in e.get("statistics") or []:
                m = (st.get("games") or {}).get("minutes")
                if m:
                    with_min += 1
                    if len(sample) < 3:
                        sample.append("{} {} мин".format(
                            (e.get("player") or {}).get("name"), m))
                    break
        print("  {} ({}/{}) клуб {}: игроков {}, с минутами {}".format(
            name, lid, season, team_nm, len(pl), with_min))
        for s in sample:
            print("     - " + s)

    print("\nБюджет после пробы: {}/{}".format(budget.used, budget.limit))
    print("ВЕРДИКТ: смотри, есть ли 'с минутами' > 0 — если везде 0, женский "
          "футбол в API без детальной статистики, собирать смысла мало.")


if __name__ == "__main__":
    main()
