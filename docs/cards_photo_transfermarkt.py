# -*- coding: utf-8 -*-
"""Read a player's portrait from their Transfermarkt profile by canonical ID.

The profile URL is read from the source page; it is never guessed from an image ID.
Default/dummy portraits are rejected. Writes only fill blank card photo fields.
"""
import argparse
import html as html_lib
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

UA = ("SherlockScholesBot/1.0 "
      "(+https://github.com/Aloews/sherlock-scholes-; giafreec@gmail.com)")
PROFILE = "https://www.transfermarkt.com/-/profil/spieler/%s"
PAUSE = 1.5
RETRIES = 3
PAGE = 1000
WRITE_BATCH = 25

META_TAG = re.compile(r"<meta\\b[^>]*>", re.I | re.S)
META_ATTR = re.compile(r"""([a-zA-Z_:][\\w:.-]*)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))""")
PLACEHOLDER = re.compile(r'/(default|dummy)[^/]*\\.[a-z]+\\Z', re.I)


def meta_image_url(html):
    for tag in META_TAG.findall(html or ""):
        attrs = {}
        for match in META_ATTR.finditer(tag):
            value = next((part for part in match.groups()[1:] if part is not None), "")
            attrs[match.group(1).lower()] = html_lib.unescape(value).strip()
        image_key = attrs.get("property", attrs.get("name", "")).casefold()
        if image_key in {"og:image", "twitter:image", "twitter:image:src"}:
            value = attrs.get("content", "").replace("\\\\/", "/").strip()
            if value:
                return value
    return None


def sb(path, method="GET", body=None, params=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    key = os.environ["SUPABASE_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": key, "Authorization": "Bearer " + key,
        "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=180) as fh:
        raw = fh.read()
    return json.loads(raw) if raw else []


def read_all(path, params):
    out, offset = [], 0
    while True:
        page = sb(path, params=dict(params, limit=PAGE, offset=offset))
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def has_profile_content(html):
    return bool(re.search(
        r"data-header__market-value-wrapper|data-header__profile-container|data-header__profile-image|dataBild",
        html or "", re.I))


def portrait_url(html):
    url = meta_image_url(html)
    if not url:
        return None
    parsed = urllib.parse.urlparse(url)
    if PLACEHOLDER.search(parsed.path):
        return None
    if (parsed.hostname or "").lower() not in {
        "img.a.transfermarkt.technology", "tmssl.akamaized.net"
    }:
        return None
    return url


def slugify_name(value):
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()


def profile_urls(card):
    player_id = str(card.get("transfermarkt_id") or "")
    if not player_id.isdigit():
        return []
    urls = []
    slug = slugify_name(card.get("name_en") or card.get("name"))
    if slug:
        for domain in ("transfermarkt.com", "transfermarkt.co.uk", "transfermarkt.world", "transfermarkt.us"):
            urls.append("https://www.%s/%s/profil/spieler/%s" % (domain, slug, player_id))
    urls.append(PROFILE % player_id)
    return list(dict.fromkeys(urls))


def get_profile(card):
    for url in profile_urls(card):
        html = get(url)
        if html and (has_profile_content(html) or portrait_url(html)):
            return html
    return None


def get(url):
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=60) as fh:
                return fh.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            if exc.code in {403, 404, 410} or attempt + 1 == RETRIES:
                return None
            time.sleep(PAUSE * 3 * (attempt + 1))
        except Exception:
            if attempt + 1 == RETRIES:
                return None
            time.sleep(PAUSE * 3 * (attempt + 1))
    return None


def rotate_candidates(rows, offset, limit):
    if offset < 0:
        raise ValueError("offset must be non-negative")
    if rows and offset:
        start = offset % len(rows)
        rows = rows[start:] + rows[:start]
    return rows[:limit] if limit else rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="how many cards (0 means all)")
    ap.add_argument("--offset", type=int, default=0, help="candidate window offset")
    ap.add_argument("--only", default="", help="process one Transfermarkt ID")
    args = ap.parse_args()
    if args.only and not args.only.isdigit():
        raise SystemExit("--only must be a numeric Transfermarkt ID")
    apply_ = os.environ.get("APPLY") == "1"
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("SUPABASE_URL and SUPABASE_KEY are required")

    rows = read_all("cards", {"select": "id,name,name_en,transfermarkt_id,photo_url",
                              "category": "eq.player", "active": "is.true",
                              "transfermarkt_id": ("eq." + args.only) if args.only else "not.is.null",
                              "order": "id"})
    rows = [row for row in rows if not str(row.get("photo_url") or "").strip()]
    if args.only:
        rows = [row for row in rows if str(row.get("transfermarkt_id") or "") == args.only]

    rows = rotate_candidates(rows, args.offset, args.limit)
    print("Cards without a photo and with a Transfermarkt ID: %d (APPLY=%s)"
          % (len(rows), "yes" if apply_ else "dry-run"), flush=True)
    if not rows:
        return

    found = placeholder = lost = written = 0
    batch = []

    def flush():
        nonlocal batch, written
        if apply_:
            for card_id, url in batch:
                sb("cards", method="PATCH",
                   params={"id": "eq." + card_id, "or": "(photo_url.is.null,photo_url.eq.)"},
                   body={"photo_url": url, "photo_source": "transfermarkt"})
                stored = sb("cards", params={"select": "id,photo_url", "id": "eq." + card_id})
                if not stored or stored[0].get("photo_url") != url:
                    raise RuntimeError("photo write verification failed for card " + card_id)
                written += 1
        batch = []

    for i, card in enumerate(rows, 1):
        html = get_profile(card)
        if html is None:
            lost += 1
        else:
            url = portrait_url(html)
            if url:
                found += 1
                batch.append((card["id"], url))
            elif meta_image_url(html):
                placeholder += 1
        if len(batch) >= WRITE_BATCH:
            flush()
        if i % 25 == 0:
            print("  %d/%d, portraits %d, placeholders %d, lost %d"
                  % (i, len(rows), found, placeholder, lost), flush=True)
        time.sleep(PAUSE)

    flush()
    print("-" * 70)
    print("Portraits found : %d" % found)
    print("Placeholders rejected: %d" % placeholder)
    print("Written         : %d" % written)
    if lost:
        print("PROFILE FETCHES LOST: %d — retry on next run" % lost)
    if not apply_:
        print("Dry run. Set APPLY=1 to write.")
    elif written == 0 and found:
        raise SystemExit("Portraits were found but no writes were verified.")


if __name__ == "__main__":
    main()
