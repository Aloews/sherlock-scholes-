"""Pilot pipeline orchestration.

Flow:
  1. /teams?league=<id>&season=<season>  -> all teams, or the first
     `pilot_limit_teams` when that config value is a positive number
     (0 / null / absent means the whole league).
  2. /players?team=<id>&season=<season>  -> squad players (paginated).
     The response shape is identical to /players?league=...&season=... so
     parse_players() works for both; querying by team keeps the pilot inside
     the 100-request/day budget instead of paging the whole league.
  3. Wikidata enrichment per player -> name_ru / source / confidence / qid.
  4. Build players_meta rows (UPSERT happens in run.py for the real run).
"""
from datetime import datetime, timezone

from scraper.api_football import PlanLimitError
from scraper.team_filter import select_teams


def parse_players(api_response):
    """Adapt an API-Football /players response.

    Structure: response[].player + response[].statistics[]. From each entry we
    take api_football_id, name_en and minutes (statistics[0].games.minutes,
    kept for the future minutes_share in player_seasons).

    player.name is often abbreviated ("A. Onana"), which Wikidata fails to
    match. firstname + lastname give the full name ("Andre Onana"), so we keep
    both: `name` (short, as before) and `full_name` (for the Wikidata search).
    """
    players = []
    for item in api_response.get("response", []):
        player = item.get("player", {}) or {}
        stats = item.get("statistics", []) or []
        minutes = None
        if stats:
            games = stats[0].get("games", {}) or {}
            minutes = games.get("minutes")
        name = player.get("name")
        firstname = player.get("firstname")
        lastname = player.get("lastname")
        if firstname and lastname:
            full_name = "{} {}".format(firstname, lastname)
        else:
            full_name = name
        players.append(
            {
                "api_football_id": player.get("id"),
                "name_en": name,
                "full_name": full_name,
                "minutes": minutes,
            }
        )
    return players


class Pipeline:
    def __init__(self, config, api_client, wikidata):
        self.league = config["league_id"]
        self.season = config["season"]
        # pilot_limit_teams: a positive number caps how many teams we process
        # (pilot mode); 0, null or absent means the WHOLE league.
        raw_limit = config.get("pilot_limit_teams")
        self.limit_teams = (
            int(raw_limit) if raw_limit and int(raw_limit) > 0 else 0
        )
        # Free tier rejects page > 3 (errors.plan). Cap pagination so we never
        # request a page the plan forbids; configurable via config["max_page"].
        self.max_page = int(config.get("max_page", 3))
        self.api = api_client
        self.wikidata = wikidata

    def collect_teams(self, wanted_names=None):
        """Fetch the league's teams and decide which to process.

        Returns (teams, missing_names). When `wanted_names` is a non-empty
        explicit club list (config teams_filter), ONLY the clubs matching that
        list are returned and any configured name with no match is reported in
        missing_names (the caller warns and continues). The explicit list wins
        over pilot_limit_teams. With no list, the previous behaviour stands:
        the first `pilot_limit_teams` teams, or the whole league when that is 0.
        """
        resp = self.api.get(
            "teams", {"league": self.league, "season": self.season}
        )
        teams = [
            entry["team"]
            for entry in resp.get("response", [])
            if entry.get("team")
        ]
        if wanted_names:
            return select_teams(teams, wanted_names)
        if self.limit_teams > 0:
            return teams[: self.limit_teams], []
        return teams, []

    def collect_players(self, teams):
        by_id = {}
        for team in teams:
            page = 1
            while True:
                try:
                    resp = self.api.get(
                        "players",
                        {"team": team["id"], "season": self.season, "page": page},
                    )
                except PlanLimitError as exc:
                    # The plan forbade this page mid-pagination: keep what we
                    # already collected for this team and move on, don't crash.
                    print(
                        "[warn] API-Football plan limit on page {} for team {}: "
                        "{}. Stopping pagination, keeping {} player(s) so far.".format(
                            page, team.get("id"), exc, len(by_id)
                        )
                    )
                    break
                for player in parse_players(resp):
                    if player["api_football_id"] is not None:
                        by_id[player["api_football_id"]] = player
                paging = resp.get("paging", {}) or {}
                total_pages = paging.get("total", 1) or 1
                # Stop at the last real page OR the plan cap, whichever is first —
                # never request page > max_page even if paging.total is larger.
                if page >= total_pages or page >= self.max_page:
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
            full_name = player.get("full_name")
            # Search Wikidata by the full name; fall back to the short name.
            enrichment = self.wikidata.enrich(player["name_en"], full_name)
            # Store the full name as name_en when available — "Andre Onana" is
            # cleaner for the game than "A. Onana".
            display_name = full_name or player["name_en"]
            rows.append(
                {
                    "api_football_id": player["api_football_id"],
                    "name_en": display_name,
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
