"""Pilot pipeline orchestration.

Flow:
  1. /teams?league=<id>&season=<season>  -> pick the first `pilot_limit_teams`.
  2. /players?team=<id>&season=<season>  -> squad players (paginated).
     The response shape is identical to /players?league=...&season=... so
     parse_players() works for both; querying by team keeps the pilot inside
     the 100-request/day budget instead of paging the whole league.
  3. Wikidata enrichment per player -> name_ru / source / confidence / qid.
  4. Build players_meta rows (UPSERT happens in run.py for the real run).
"""
from datetime import datetime, timezone


def parse_players(api_response):
    """Adapt an API-Football /players response.

    Structure: response[].player + response[].statistics[]. From each entry we
    take api_football_id, name_en and minutes (statistics[0].games.minutes,
    kept for the future minutes_share in player_seasons).
    """
    players = []
    for item in api_response.get("response", []):
        player = item.get("player", {}) or {}
        stats = item.get("statistics", []) or []
        minutes = None
        if stats:
            games = stats[0].get("games", {}) or {}
            minutes = games.get("minutes")
        players.append(
            {
                "api_football_id": player.get("id"),
                "name_en": player.get("name"),
                "minutes": minutes,
            }
        )
    return players


class Pipeline:
    def __init__(self, config, api_client, wikidata):
        self.league = config["league_id"]
        self.season = config["season"]
        self.limit_teams = int(config.get("pilot_limit_teams", 1))
        self.api = api_client
        self.wikidata = wikidata

    def collect_teams(self):
        resp = self.api.get(
            "teams", {"league": self.league, "season": self.season}
        )
        teams = [
            entry["team"]
            for entry in resp.get("response", [])
            if entry.get("team")
        ]
        return teams[: self.limit_teams]

    def collect_players(self, teams):
        by_id = {}
        for team in teams:
            page = 1
            while True:
                resp = self.api.get(
                    "players",
                    {"team": team["id"], "season": self.season, "page": page},
                )
                for player in parse_players(resp):
                    if player["api_football_id"] is not None:
                        by_id[player["api_football_id"]] = player
                paging = resp.get("paging", {}) or {}
                total_pages = paging.get("total", 1) or 1
                if page >= total_pages:
                    break
                page += 1
        return list(by_id.values())

    def build_rows(self, players):
        """Enrich each player and produce players_meta rows.

        Keys prefixed with `_` are report-only and stripped before any write.
        """
        rows = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for player in players:
            enrichment = self.wikidata.enrich(player["name_en"])
            rows.append(
                {
                    "api_football_id": player["api_football_id"],
                    "name_en": player["name_en"],
                    "name_ru": enrichment["name_ru"],
                    "name_source": enrichment["name_source"],
                    "name_confidence": enrichment["name_confidence"],
                    "wikidata_qid": enrichment["wikidata_qid"],
                    "updated_at": now_iso,
                    "_minutes": player["minutes"],
                }
            )
        return rows


def to_db_rows(rows):
    """Drop report-only `_`-prefixed keys before writing to Supabase."""
    return [
        {k: v for k, v in row.items() if not k.startswith("_")} for row in rows
    ]
