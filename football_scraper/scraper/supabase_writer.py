"""Write players_meta rows to Supabase via the PostgREST endpoint.

UPSERT on api_football_id (ON CONFLICT api_football_id) using
`Prefer: resolution=merge-duplicates`. URL and key come from the
environment (SUPABASE_URL / SUPABASE_KEY) — never hardcoded.

Only the players_meta table is touched here. player_seasons is intentionally
left untouched at the pilot stage.
"""
import requests


class SupabaseWriter:
    def __init__(self, url, key):
        self.endpoint = url.rstrip("/") + "/rest/v1/players_meta"
        self.headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        }

    def upsert(self, rows):
        if not rows:
            return []
        resp = requests.post(
            self.endpoint,
            headers=self.headers,
            params={"on_conflict": "api_football_id"},
            json=rows,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
