"""Read/write Supabase tables via the PostgREST endpoint.

SupabaseWriter        — UPSERT players_meta rows on api_football_id.
PlayerSeasonsClient   — READ players_meta (for the pageviews step) and UPSERT
                        player_seasons rows on (player_id, league, season).

All UPSERTs use `Prefer: resolution=merge-duplicates`, so re-running never
creates duplicates and an UPSERT that sets only `pageviews` leaves the other
player_seasons columns (popularity_score/rank, ...) untouched — those are
computed in a separate later step. URL and key come from the environment
(SUPABASE_URL / SUPABASE_KEY) — never hardcoded.

Name-quality guard (players_meta): a plain merge-duplicates UPSERT overwrites
EVERY column, so re-running for a later season could clobber a good Russian
name (name_ru, high) with a worse one (null/low) from a poorer Wikidata search.
To prevent that, SupabaseWriter.upsert() first GETs the existing rows (batched)
and merges the name fields in code — see merge_player_name() — keeping the
better name. Only then does it write.
"""
import requests

from scraper.dedup import canonical_key

# Russian-name confidence ranking: high beats low beats none/empty.
CONFIDENCE_RANK = {"high": 2, "low": 1, "none": 0}


def normalize_card_name(name):
    """Key used to dedup a player against existing cards: trimmed, internal
    whitespace collapsed, case-folded. Two names that differ only in spacing
    or case are treated as the same card so we never add a duplicate."""
    return " ".join((name or "").split()).casefold()


def build_forbidden_words(name):
    """Forbidden words for a player card, matching the existing deck's format:
    the full name first, then each token, de-duplicated in order.
      'Игнацио Абате' -> ['Игнацио Абате', 'Игнацио', 'Абате']
      'Адриано'       -> ['Адриано']
    """
    clean = " ".join((name or "").split())
    words = [clean] + clean.split()
    seen = set()
    out = []
    for w in words:
        if w and w not in seen:
            seen.add(w)
            out.append(w)
    return out

# The name group travels together: name_ru and its provenance, plus the
# wikidata_qid that produced it (keeping a stale qid next to a fresh-but-empty
# name would be inconsistent). name_en / updated_at are NOT in this group and
# are always taken from the incoming row.
NAME_FIELDS = ("name_ru", "name_source", "name_confidence", "wikidata_qid")


def _rank(confidence):
    """Map a name_confidence string to a comparable rank (unknown -> 0)."""
    if not confidence:
        return 0
    return CONFIDENCE_RANK.get(confidence, 0)


def merge_player_name(existing, incoming):
    """Decide the name group for one player. Returns (row, preserved).

    `existing` is the row already in players_meta (name fields only) or None
    for a brand-new player; `incoming` is the freshly-built row.

    The incoming name group is taken ONLY when its name_ru is non-empty AND its
    confidence rank is >= the existing one. Otherwise the existing name group is
    kept, so a good name (e.g. high) is never overwritten by a worse/empty one
    (e.g. null/low). All non-name fields always come from `incoming`.

    preserved=True means the guard fired: we kept a non-empty existing name
    instead of overwriting it with a worse/empty incoming one.
    """
    row = dict(incoming)
    if not existing:
        return row, False

    new_ru = (incoming.get("name_ru") or "").strip()
    old_ru = (existing.get("name_ru") or "").strip()

    take_incoming = bool(new_ru) and _rank(
        incoming.get("name_confidence")
    ) >= _rank(existing.get("name_confidence"))

    if take_incoming:
        return row, False

    # Keep the existing name group; the incoming one is worse or empty.
    for field in NAME_FIELDS:
        row[field] = existing.get(field)
    return row, bool(old_ru)


def _name_quality(row):
    """Comparable quality of a row's Russian name: (has_name_ru, conf_rank).
    Used to pick the better of two rows that share an api_football_id."""
    has_ru = 1 if (row.get("name_ru") or "").strip() else 0
    return (has_ru, _rank(row.get("name_confidence")))


def dedup_rows_by_id(rows, id_field="api_football_id"):
    """Collapse rows that share the same id, keeping the better-named one.

    PostgreSQL's INSERT ... ON CONFLICT cannot touch the same target row twice
    in one statement: a batch with two rows of the same conflict key fails with
    HTTP 409 ("ON CONFLICT DO UPDATE command cannot affect row a second time").
    API-Football can list a player under two clubs in a season (or repeat them
    across pages), so a single team's batch can carry the same api_football_id
    twice. We collapse such duplicates before the write, preferring the row that
    has a Russian name / higher name_confidence; on equal name quality the LAST
    occurrence wins (dict-by-id, last-write semantics).

    Rows whose id is None do not conflict (SQL NULLs are distinct) and pass
    through unchanged. Returns (deduped_rows, dup_counts) where dup_counts maps
    each duplicated id to how many times it appeared (>1). First-seen order is
    preserved for non-null ids.
    """
    best = {}
    counts = {}
    passthrough = []
    for row in rows:
        rid = row.get(id_field)
        if rid is None:
            passthrough.append(row)
            continue
        counts[rid] = counts.get(rid, 0) + 1
        if rid not in best:
            best[rid] = row
        elif _name_quality(row) >= _name_quality(best[rid]):
            # >= so that on a name-quality tie the last row wins, while a row
            # carrying name_ru still beats an earlier name-less one.
            best[rid] = row
    dup_counts = {rid: n for rid, n in counts.items() if n > 1}
    return list(best.values()) + passthrough, dup_counts


def _pageviews_of(row):
    """pageviews as a sortable int (missing/None sorts lowest)."""
    pv = row.get("pageviews")
    return pv if isinstance(pv, int) else -1


def dedup_card_rows(rows):
    """Collapse card rows that map to the same canonical_key, keeping the one
    with the higher pageviews (the more informative record).

    --to-cards already dedups new players against the deck and against each
    other, but this is a final guard so one batch can never insert two cards for
    the same player under a different spelling / word order. Rows whose name
    canonicalises to '' are passed through unchanged. Returns (deduped, dropped).
    """
    best = {}
    passthrough = []
    dropped = 0
    for row in rows:
        key = canonical_key(row.get("name"))
        if not key:
            passthrough.append(row)
            continue
        if key not in best:
            best[key] = row
        else:
            dropped += 1
            if _pageviews_of(row) > _pageviews_of(best[key]):
                best[key] = row
    return list(best.values()) + passthrough, dropped


class SupabaseWriter:
    def __init__(self, url, key):
        self.endpoint = url.rstrip("/") + "/rest/v1/players_meta"
        self.headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        }
        self.read_headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
        }
        # Running tally of players whose existing name was kept because the
        # incoming one was worse/empty (the name-quality guard fired). Read by
        # run.py for the final summary; accumulates across upsert() calls.
        self.names_preserved = 0
        # Running tally of duplicate rows collapsed before write (same
        # api_football_id inside one batch). Accumulates across upsert() calls.
        self.dupes_collapsed = 0
        # Running tally of wikidata_qid values dropped (set to NULL) because
        # the qid was already taken by ANOTHER api_football_id — in the batch
        # or in the DB. wikidata_qid is UNIQUE too, and on_conflict=
        # api_football_id cannot resolve a conflict on that second key, so a
        # colliding qid would 409 the whole chunk. Accumulates across calls.
        self.qids_dropped = 0

    def fetch_existing(self, api_football_ids, chunk_size=100):
        """Return {api_football_id: row} for ids already in players_meta.

        Only the name fields needed by merge_player_name() are selected. The
        lookup is batched with the PostgREST `in.(...)` filter (chunked to keep
        each URL bounded) — one GET per chunk, never one per player.
        """
        ids = [i for i in api_football_ids if i is not None]
        existing = {}
        if not ids:
            return existing
        columns = "api_football_id," + ",".join(NAME_FIELDS)
        for start in range(0, len(ids), chunk_size):
            chunk = ids[start : start + chunk_size]
            in_list = "(" + ",".join(str(i) for i in chunk) + ")"
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={"select": columns, "api_football_id": "in." + in_list},
                timeout=30,
            )
            resp.raise_for_status()
            for row in resp.json():
                existing[row.get("api_football_id")] = row
        return existing

    def _fetch_qid_owners(self, qids, chunk_size=100):
        """Return {wikidata_qid: api_football_id} for qids already in
        players_meta. Batched like fetch_existing(); qids are plain
        Q-identifiers so they go into the `in.(...)` filter unquoted."""
        owners = {}
        qids = [q for q in qids if q]
        for start in range(0, len(qids), chunk_size):
            chunk = qids[start : start + chunk_size]
            in_list = "(" + ",".join(chunk) + ")"
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={
                    "select": "api_football_id,wikidata_qid",
                    "wikidata_qid": "in." + in_list,
                },
                timeout=30,
            )
            resp.raise_for_status()
            for row in resp.json():
                owners[row.get("wikidata_qid")] = row.get("api_football_id")
        return owners

    def _resolve_qid_conflicts(self, rows):
        """NULL out wikidata_qid wherever it would violate the qid UNIQUE key.

        wikidata_qid is a SECOND unique constraint that on_conflict=
        api_football_id cannot merge on, so any qid collision 409s the whole
        chunk. Two cases, both real (API-Football lists the same human under
        two ids, e.g. Stuttgart's Moussa Cissé 328464/453965 -> Q128871829):

        1. In-batch: several rows share one qid. The row with the better
           Russian name (see _name_quality; tie -> last) keeps it, the rest
           get qid=None. name_ru is kept — only the provenance qid is dropped.
        2. Against the DB: the qid already belongs to a DIFFERENT
           api_football_id row. The incoming row gets qid=None; the existing
           row is left untouched.

        Every dropped qid is logged with both ids so the duplicate player can
        be reviewed manually. Rows are the dict copies made by
        merge_player_name(), so mutating them is safe.
        """
        by_qid = {}
        for row in rows:
            qid = row.get("wikidata_qid")
            if qid:
                by_qid.setdefault(qid, []).append(row)

        # Case 1: the same qid on several rows inside this batch.
        for qid, group in by_qid.items():
            if len(group) < 2:
                continue
            keeper = group[0]
            for row in group[1:]:
                if _name_quality(row) >= _name_quality(keeper):
                    keeper = row
            losers = [r for r in group if r is not keeper]
            for row in losers:
                row["wikidata_qid"] = None
            self.qids_dropped += len(losers)
            print(
                "[dedup] wikidata_qid {} shared by api_football_id {} in one "
                "batch — kept on {}, dropped from the rest (likely the same "
                "player under two API ids)".format(
                    qid,
                    sorted(r.get("api_football_id") for r in group),
                    keeper.get("api_football_id"),
                )
            )

        # Case 2: the qid is already owned by a different api_football_id row.
        qid_to_row = {
            r["wikidata_qid"]: r for r in rows if r.get("wikidata_qid")
        }
        owners = self._fetch_qid_owners(list(qid_to_row))
        for qid, owner_id in owners.items():
            row = qid_to_row[qid]
            if owner_id != row.get("api_football_id"):
                row["wikidata_qid"] = None
                self.qids_dropped += 1
                print(
                    "[dedup] wikidata_qid {} already belongs to "
                    "api_football_id {} in players_meta — dropped from "
                    "incoming api_football_id {} (likely the same player "
                    "under two API ids)".format(
                        qid, owner_id, row.get("api_football_id")
                    )
                )
        return rows

    def _upsert_one_by_one(self, chunk):
        """409 fallback: write a failed chunk row by row so one bad row never
        loses the whole team. A row that 409s on its own is retried once with
        wikidata_qid=None (the only other unique key); a row that still fails
        is logged and skipped. Returns the written representations."""
        written = []
        for row in chunk:
            try:
                resp = requests.post(
                    self.endpoint,
                    headers=self.headers,
                    params={"on_conflict": "api_football_id"},
                    json=[row],
                    timeout=30,
                )
                resp.raise_for_status()
                written.extend(resp.json())
                continue
            except requests.HTTPError as exc:
                if exc.response is None or exc.response.status_code != 409:
                    raise
            retry = dict(row)
            retry["wikidata_qid"] = None
            if retry == row:
                # qid was already NULL — nothing left to strip; skip the row.
                print(
                    "[409] row api_football_id={} ({}) still conflicts with "
                    "no qid to drop — skipped".format(
                        row.get("api_football_id"), row.get("name_en")
                    )
                )
                continue
            try:
                resp = requests.post(
                    self.endpoint,
                    headers=self.headers,
                    params={"on_conflict": "api_football_id"},
                    json=[retry],
                    timeout=30,
                )
                resp.raise_for_status()
                written.extend(resp.json())
                self.qids_dropped += 1
                print(
                    "[409] row api_football_id={} ({}) conflicted on "
                    "wikidata_qid {} — written without the qid".format(
                        row.get("api_football_id"),
                        row.get("name_en"),
                        row.get("wikidata_qid"),
                    )
                )
            except requests.HTTPError as exc:
                if exc.response is None or exc.response.status_code != 409:
                    raise
                print(
                    "[409] row api_football_id={} ({}) failed even without "
                    "qid — skipped".format(
                        row.get("api_football_id"), row.get("name_en")
                    )
                )
        return written

    def upsert(self, rows, chunk_size=50):
        """Merge against existing rows, then UPSERT in chunks of `chunk_size`.

        Before writing, the rows are merged against whatever is already in
        players_meta (fetched in one batched GET) so a good Russian name is
        never overwritten by a worse/empty one — see merge_player_name(). Every
        time the guard keeps an old name, self.names_preserved is incremented.

        Splitting the write keeps each POST small (a full squad is ~25-30 rows,
        but the caller may pass more). The UPSERT key stays api_football_id, so
        re-running never creates duplicates. Returns the representations of all
        written rows. Any HTTP error propagates to the caller, which decides
        whether to keep going with the next team.
        """
        if not rows:
            return []

        existing = self.fetch_existing([r.get("api_football_id") for r in rows])
        merged_rows = []
        for row in rows:
            merged, preserved = merge_player_name(
                existing.get(row.get("api_football_id")), row
            )
            if preserved:
                self.names_preserved += 1
            merged_rows.append(merged)

        # Collapse rows sharing an api_football_id so no single POST (= one
        # ON CONFLICT statement) ever targets the same conflict key twice — the
        # cause of the HTTP 409. Done across the whole batch before chunking, so
        # an id can appear at most once in any chunk regardless of chunk_size.
        merged_rows, dup_counts = dedup_rows_by_id(merged_rows)
        if dup_counts:
            self.dupes_collapsed += sum(n - 1 for n in dup_counts.values())
            detail = ", ".join(
                "{}×{}".format(rid, n) for rid, n in sorted(dup_counts.items())
            )
            print("[dedup] collapsed duplicate api_football_id in batch: " + detail)

        # wikidata_qid is a SECOND unique key that on_conflict=api_football_id
        # cannot merge on; resolve those collisions (in-batch and vs the DB)
        # before writing — the other source of HTTP 409.
        merged_rows = self._resolve_qid_conflicts(merged_rows)

        written = []
        for start in range(0, len(merged_rows), chunk_size):
            chunk = merged_rows[start : start + chunk_size]
            # Belt-and-braces: re-collapse INSIDE the chunk right before the
            # POST, so the no-duplicate-conflict-key invariant holds for every
            # statement on its own, whatever happened upstream.
            chunk, chunk_dups = dedup_rows_by_id(chunk)
            if chunk_dups:
                self.dupes_collapsed += sum(
                    n - 1 for n in chunk_dups.values()
                )
                detail = ", ".join(
                    "{}×{}".format(rid, n)
                    for rid, n in sorted(chunk_dups.items())
                )
                print(
                    "[dedup] collapsed duplicate api_football_id in chunk: "
                    + detail
                )
            try:
                resp = requests.post(
                    self.endpoint,
                    headers=self.headers,
                    params={"on_conflict": "api_football_id"},
                    json=chunk,
                    timeout=30,
                )
                resp.raise_for_status()
                written.extend(resp.json())
            except requests.HTTPError as exc:
                if exc.response is None or exc.response.status_code != 409:
                    raise
                # A conflict slipped through (e.g. a unique key we don't
                # know about): salvage the chunk row by row instead of
                # losing the whole team.
                print(
                    "[409] chunk of {} rows conflicted — retrying row by "
                    "row".format(len(chunk))
                )
                written.extend(self._upsert_one_by_one(chunk))
        return written


class PlayerSeasonsClient:
    """Reads players_meta and UPSERTs player_seasons (pageviews step)."""

    def __init__(self, url, key):
        base = url.rstrip("/") + "/rest/v1"
        self.players_endpoint = base + "/players_meta"
        self.seasons_endpoint = base + "/player_seasons"
        self.career_endpoint = base + "/player_career"
        self.read_headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
        }
        self.write_headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        }

    # ---- --collect-history (paid tier) -------------------------------------
    def fetch_history_targets(self, refresh=False, limit=None, page_size=1000):
        """players_meta rows to collect career history for: every row with an
        api_football_id. Unless refresh=True, rows already stamped with
        history_collected_at are skipped (resume). Returns dicts with
        api_football_id. Requires docs/player_history_schema.sql."""
        # Pre-schema (player_history_schema.sql not applied yet): the
        # history_collected_at column is missing -> PostgREST 400s. Fall back
        # to a plain api_football_id list so a --dry-run estimate still works.
        have_marker = True
        params_base = {"select": "api_football_id,history_collected_at",
                       "api_football_id": "not.is.null", "order": "api_football_id.asc"}
        if not refresh:
            params_base["history_collected_at"] = "is.null"
        rows, offset = [], 0
        while True:
            params = dict(params_base)
            params["limit"] = page_size
            params["offset"] = offset
            resp = requests.get(self.players_endpoint, headers=self.read_headers,
                                params=params, timeout=30)
            if resp.status_code == 400 and have_marker:
                have_marker = False
                params_base = {"select": "api_football_id",
                               "api_football_id": "not.is.null",
                               "order": "api_football_id.asc"}
                rows = []
                continue
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
            if limit and len(rows) >= limit:
                break
        return rows[:limit] if limit else rows

    def set_player_history(self, api_football_id, transfers=None, trophies=None):
        """Write transfers/trophies JSONB and stamp history_collected_at (the
        resume marker) on a players_meta row, keyed by api_football_id."""
        from datetime import datetime, timezone
        body = {
            "transfers": transfers,
            "trophies": trophies,
            "history_collected_at": datetime.now(timezone.utc).isoformat(),
        }
        headers = dict(self.write_headers)
        headers["Prefer"] = "return=minimal"
        resp = requests.patch(
            self.players_endpoint, headers=headers,
            params={"api_football_id": "eq." + str(api_football_id)},
            json=body, timeout=30)
        resp.raise_for_status()

    def upsert_career(self, rows, chunk_size=200):
        """UPSERT player_career rows on its PK (api_football_id, season,
        club_id, league_id). merge-duplicates so a re-run overwrites cleanly."""
        if not rows:
            return
        headers = dict(self.write_headers)
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i:i + chunk_size]
            resp = requests.post(
                self.career_endpoint, headers=headers,
                params={"on_conflict": "api_football_id,season,club_id,league_id"},
                json=chunk, timeout=60)
            resp.raise_for_status()

    def fetch_players_meta(self, page_size=1000, with_photo=False):
        """Return all players_meta rows we need to resolve articles.

        Selects only the columns the pageviews step uses. Paginates with
        limit/offset so a large table is fetched in bounded chunks.
        with_photo=True adds photo_url (--photos / --to-cards) — it 400s
        until supabase/migrations/photo_url.sql has been applied, so the
        callers fall back to the legacy column list.
        """
        columns = "id,api_football_id,wikidata_qid,name_en,name_ru"
        if with_photo:
            columns += ",photo_url"
        rows = []
        offset = 0
        while True:
            resp = requests.get(
                self.players_endpoint,
                headers=self.read_headers,
                params={
                    "select": columns,
                    "order": "id.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    def fetch_pageviews_max(self, season=None, page_size=1000):
        """Return {player_id: pageviews}, MAX across leagues — and across ALL
        seasons when `season` is None.

        A player who appears in several leagues (e.g. transferred mid-career,
        scraped twice) — or whose leagues were scraped for different seasons
        (top-5 at 2023, RPL at 2024) — gets all his rows collapsed to the
        HIGHEST pageviews value — the strongest popularity signal he has.
        Pass a season to restrict the join to that season only. Used by the
        --to-cards step (season=None). Paginated with limit/offset. pageviews
        may be None when every row for the player exists without a collected
        value.
        """
        result = {}
        offset = 0
        while True:
            params = {
                "select": "player_id,pageviews",
                "order": "player_id.asc",
                "limit": page_size,
                "offset": offset,
            }
            if season is not None:
                params["season"] = "eq." + str(season)
            resp = requests.get(
                self.seasons_endpoint,
                headers=self.read_headers,
                params=params,
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            for row in batch:
                pid = row.get("player_id")
                if pid is None:
                    continue
                pv = row.get("pageviews")
                # Keep the max; a real value always beats None.
                if pid not in result:
                    result[pid] = pv
                elif pv is not None and (
                    result[pid] is None or pv > result[pid]
                ):
                    result[pid] = pv
            if len(batch) < page_size:
                break
            offset += page_size
        return result

    def set_player_photo(self, player_id, photo_url):
        """PATCH one player's photo_url (--photos step). Row-by-row on
        purpose: ids come straight from fetch_players_meta, and a per-row
        write keeps an interrupted run's progress, mirroring the flushed
        pageviews upserts. The Wikidata pause dominates the runtime anyway."""
        resp = requests.patch(
            self.players_endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(player_id)},
            json={"photo_url": photo_url},
            timeout=30,
        )
        resp.raise_for_status()

    def upsert_player_seasons(self, rows, chunk_size=200):
        """UPSERT player_seasons rows on (player_id, league, season).

        Each row carries player_id, league, season and pageviews. merge-
        duplicates updates pageviews in place without disturbing the other
        (popularity) columns. Returns the written representations.
        """
        if not rows:
            return []
        written = []
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            resp = requests.post(
                self.seasons_endpoint,
                headers=self.write_headers,
                params={"on_conflict": "player_id,league,season"},
                json=chunk,
                timeout=30,
            )
            resp.raise_for_status()
            written.extend(resp.json())
        return written


class CardsClient:
    """Reads existing card names (for dedup) and INSERTs new player cards.

    The game deck (`cards`) has no unique constraint on `name`, so the
    --to-cards step dedups in code: it fetches every existing card name once,
    reduces it to a canonical_key (see scraper/dedup.py — fuzzy: word order +
    Latin->Cyrillic + punctuation) and skips any player already in the deck.
    Using canonical_key instead of a plain string match means a player already
    present under a different spelling/order is recognised as the same card, so
    importing a new league does not duplicate existing players. That also keeps
    a re-run idempotent — the second run sees the cards the first one inserted
    and adds nothing new. Existing cards are never read for modification and
    never touched.
    """

    def __init__(self, url, key):
        self.endpoint = url.rstrip("/") + "/rest/v1/cards"
        self.translations_endpoint = (
            url.rstrip("/") + "/rest/v1/card_translations")
        self.read_headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
        }
        self.write_headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def fetch_existing_card_keys(self, page_size=1000):
        """Return a set of canonical_key values for every card in the deck.

        Each card name is reduced with canonical_key (fuzzy: word order +
        Latin->Cyrillic + punctuation), so the --to-cards dedup matches players
        already present under a different spelling/order. Selects only `name`
        and paginates with limit/offset so the full deck (~2000+ rows) comes
        back in bounded chunks. Used purely for dedup.
        """
        keys = set()
        offset = 0
        while True:
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={
                    "select": "name",
                    "order": "name.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            for row in batch:
                key = canonical_key(row.get("name"))
                if key:
                    keys.add(key)
            if len(batch) < page_size:
                break
            offset += page_size
        return keys

    def fetch_cards_for_dedup(self, page_size=1000):
        """Return every card as {id, name, category, category_ru} for the
        duplicate finder. READ-ONLY — selects only display columns and never
        modifies anything. Paginated with limit/offset so the full deck comes
        back in bounded chunks."""
        cards = []
        offset = 0
        while True:
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={
                    "select": "id,name,category,category_ru",
                    "order": "name.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            cards.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return cards

    def fetch_cards_missing_pageviews(self, page_size=1000):
        """Return every card (ANY category) whose pageviews IS NULL as
        {id, name, name_en, category} (name_en feeds the discounted enwiki
        fallback). These are the manual cards the difficulty filter cannot
        see — the --cards-pageviews step backfills them. Paginated with
        limit/offset; filtering server-side keeps re-runs idempotent
        (already-backfilled cards never come back)."""
        rows = []
        offset = 0
        while True:
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={
                    "select": "id,name,name_en,category",
                    "pageviews": "is.null",
                    "order": "id.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    def fetch_cards_missing_photo(self, exclude_categories, page_size=1000):
        """Return cards whose photo_url IS NULL outside `exclude_categories`
        as {id, name, name_en, category} — the --cards-photos work list
        (name_en feeds the enwiki fallback when ruwiki has no article).

        exclude_categories is an iterable of category values to leave alone
        (player has its own --photos pipeline; term/position are abstract and
        have no photo). Cards with category NULL are skipped too: PostgREST's
        not.in keeps only rows where the filter is true, and NULL compares to
        nothing. Filtering server-side keeps re-runs idempotent (cards that
        already got a photo never come back). Paginated with limit/offset.
        Requires cards.photo_url (supabase/migrations/photo_url.sql) — 400s
        until the migration is applied."""
        rows = []
        offset = 0
        while True:
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={
                    "select": "id,name,name_en,category",
                    "photo_url": "is.null",
                    "category": "not.in.({})".format(
                        ",".join(exclude_categories)),
                    "order": "id.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    def fetch_cards_missing_name_en(self, categories, page_size=1000):
        """Return cards whose name_en IS NULL within `categories` as
        {id, name, category} — the --cards-name-en work list (people
        categories only; clubs/terms don't need an English display name).
        Server-side filters keep re-runs idempotent: a card that got its
        name_en never comes back. Paginated with limit/offset."""
        rows = []
        offset = 0
        while True:
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={
                    "select": "id,name,category",
                    "name_en": "is.null",
                    "category": "in.({})".format(",".join(categories)),
                    "order": "id.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    def fetch_cards_having_name_en(self, categories, page_size=1000):
        """Return cards whose name_en is ALREADY set within `categories` as
        {id, name, name_en, category} — the --cards-name-en --redo-translit
        work list: cards whose name_en may be a transliteration to upgrade
        once the article resolves (e.g. via the search fallback). name_en is
        selected too so an unchanged resolution can skip the PATCH.
        Paginated with limit/offset."""
        rows = []
        offset = 0
        while True:
            resp = requests.get(
                self.endpoint,
                headers=self.read_headers,
                params={
                    "select": "id,name,name_en,category",
                    "name_en": "not.is.null",
                    "category": "in.({})".format(",".join(categories)),
                    "order": "id.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    def fetch_translation_pairs(self, page_size=1000):
        """Return a set of (card_id, lang) pairs already present in
        card_translations — the --cards-translations skip-list, so a re-run
        only writes what is missing. Requires docs/card_translations.sql."""
        pairs = set()
        offset = 0
        while True:
            resp = requests.get(
                self.translations_endpoint,
                headers=self.read_headers,
                params={
                    "select": "card_id,lang",
                    "order": "card_id.asc,lang.asc",
                    "limit": page_size,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            batch = resp.json()
            pairs.update((r["card_id"], r["lang"]) for r in batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return pairs

    def upsert_card_translations(self, rows, chunk_size=200):
        """UPSERT card_translations rows on (card_id, lang) — merge-duplicates,
        so a re-run updates names in place and never errors on existing pairs.
        Each row: {card_id, lang, name, source}."""
        headers = dict(self.write_headers)
        headers["Prefer"] = "resolution=merge-duplicates"
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i:i + chunk_size]
            resp = requests.post(
                self.translations_endpoint,
                headers=headers,
                params={"on_conflict": "card_id,lang"},
                json=chunk,
                timeout=60,
            )
            resp.raise_for_status()

    def set_card_name_en(self, card_id, name_en):
        """PATCH one card's name_en (--cards-name-en step). Row-by-row so an
        interrupted run keeps everything already written."""
        resp = requests.patch(
            self.endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(card_id)},
            json={"name_en": name_en},
            timeout=30,
        )
        resp.raise_for_status()

    def set_card_photo(self, card_id, photo_url):
        """PATCH one card's photo_url (--cards-photos step). Row-by-row so an
        interrupted run keeps everything already written; the 1s Wikimedia
        pause dominates the runtime anyway."""
        resp = requests.patch(
            self.endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(card_id)},
            json={"photo_url": photo_url},
            timeout=30,
        )
        resp.raise_for_status()

    def set_card_continent(self, card_id, continent):
        """PATCH one card's continent (--cards-country step), guarded by
        continent IS NULL so a re-run is idempotent. Row-by-row keeps an
        interrupted run's progress."""
        resp = requests.patch(
            self.endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(card_id), "continent": "is.null"},
            json={"continent": continent},
            timeout=30,
        )
        resp.raise_for_status()

    def set_card_country(self, card_id, iso):
        """PATCH one card's country (ISO code, --cards-country step), guarded
        by country IS NULL so a re-run is idempotent. Requires the country
        column (docs/cards_country_column.sql)."""
        resp = requests.patch(
            self.endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(card_id), "country": "is.null"},
            json={"country": iso},
            timeout=30,
        )
        resp.raise_for_status()

    def set_card_legend_career(self, card_id, career):
        """PATCH one card's legend_career JSONB (--cards-legend-career),
        guarded by legend_career IS NULL so a re-run is idempotent. Requires
        docs/cards_legend_career_column.sql."""
        resp = requests.patch(
            self.endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(card_id), "legend_career": "is.null"},
            json={"legend_career": career},
            timeout=30,
        )
        resp.raise_for_status()

    def set_card_position(self, card_id, position_ru):
        """PATCH one card's position_ru (--cards-position step), guarded by
        position_ru IS NULL so a re-run is idempotent. Requires the
        position_ru column (docs/cards_position_column.sql)."""
        resp = requests.patch(
            self.endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(card_id), "position_ru": "is.null"},
            json={"position_ru": position_ru},
            timeout=30,
        )
        resp.raise_for_status()

    def set_card_pageviews(self, card_id, views):
        """PATCH one card's pageviews (--cards-pageviews step). Row-by-row so
        an interrupted run keeps everything already written; the 1s Wikimedia
        pause dominates the runtime anyway."""
        resp = requests.patch(
            self.endpoint,
            headers=self.write_headers,
            params={"id": "eq." + str(card_id)},
            json={"pageviews": int(views)},
            timeout=30,
        )
        resp.raise_for_status()

    def insert_cards(self, rows, chunk_size=100):
        """INSERT new card rows in chunks. Plain insert (no on_conflict): the
        caller has already removed duplicates against the existing deck, so
        every row here is new. Returns the written representations."""
        if not rows:
            return []
        written = []
        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            resp = requests.post(
                self.endpoint,
                headers=self.write_headers,
                json=chunk,
                timeout=30,
            )
            resp.raise_for_status()
            written.extend(resp.json())
        return written
