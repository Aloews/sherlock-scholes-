# -*- coding: utf-8 -*-
"""Collect verified player portraits from canonical Transfermarkt profiles.

The persistent backfill worker invokes this collector per card after checking
whether an earlier source has already written a reachable photo. The profile
URL is read from the source page; default/dummy portraits are rejected, and
writes only fill blank card photo fields. Source linkage to Soccer Wiki does
not suppress this fallback because a linked source row may have no usable image.
"""
import argparse
import html as html_lib
from html.parser import HTMLParser
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
RETRIES = 2
PAGE = 1000
WRITE_BATCH = 25

META_TAG = re.compile(r"<meta\b[^>]*>", re.I | re.S)
META_ATTR = re.compile(r"""([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
PLACEHOLDER = re.compile(r'/(default|dummy)[^/]*\.[a-z]+\Z', re.I)


def meta_image_url(html):
    for tag in META_TAG.findall(html or ""):
        attrs = {}
        for match in META_ATTR.finditer(tag):
            value = next((part for part in match.groups()[1:] if part is not None), "")
            attrs[match.group(1).lower()] = html_lib.unescape(value).strip()
        image_key = attrs.get("property", attrs.get("name", "")).casefold()
        if image_key in {"og:image", "twitter:image", "twitter:image:src"}:
            value = attrs.get("content", "").replace("\\/", "/").strip()
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
    """PostgREST режет по db-max-rows=1000 — без страниц теряется хвост."""
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

class ProfileImageParser(HTMLParser):
    VOID_TAGS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
    }

    def __init__(self):
        super().__init__()
        self.urls = []
        self.stack = []
        self.profile_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        values = {key.lower(): html_lib.unescape(value or "").strip()
                  for key, value in attrs}
        classes = values.get("class", "").casefold().split()
        marked_profile = (
            "data-header__profile-image" in classes
            or "data-header__profile-container" in classes
            or any("profile-image" in value for value in classes)
            or "data-bild" in values
            or "databild" in values
        )
        in_profile = self.profile_depth > 0 or marked_profile

        # Recent Transfermarkt layouts can put the marker on a wrapping div and
        # expose the actual portrait on a nested picture/source or srcset.
        if tag in {"img", "source"} and in_profile:
            for key in (
                "src", "data-src", "data-bild", "databild",
                "data-original", "data-lazy-src",
            ):
                value = values.get(key, "")
                if value:
                    self.urls.append(value)
            for key in ("srcset", "data-srcset"):
                value = values.get(key, "")
                if not value:
                    continue
                for candidate in value.split(","):
                    url = candidate.strip().split()
                    if url:
                        self.urls.append(url[0])

        if tag not in self.VOID_TAGS:
            self.stack.append((tag, marked_profile))
            if marked_profile:
                self.profile_depth += 1

    def handle_endtag(self, tag):
        tag = tag.lower()
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                for _, marked_profile in self.stack[index:]:
                    if marked_profile:
                        self.profile_depth = max(0, self.profile_depth - 1)
                del self.stack[index:]
                break


def profile_image_urls(html):
    parser = ProfileImageParser()
    try:
        parser.feed(html or "")
    except Exception:
        return []
    return parser.urls


def image_reachable(url):
    """Проверяет, что URL реально отдаёт изображение до записи в карточку."""
    if not url:
        return False
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Range": "bytes=0-1023", "Accept": "image/*"
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            response.read(1024)
            return response.status < 400 and content_type.startswith("image/")
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


def portrait_url(html):
    """Адрес портрета со страницы профиля — или None.

    ЧИСТАЯ ФУНКЦИЯ, и её проверяет тест: заглушку она обязана отвергать, иначе
    в колоду попадёт серый силуэт под видом фотографии.
    """
    candidates = [meta_image_url(html), *profile_image_urls(html)]
    for url in candidates:
        if not url:
            continue
        # Transfermarkt uses protocol-relative and lazy-loaded URLs in some
        # profile layouts. Normalize them before applying the host allowlist.
        url = urllib.parse.urljoin("https://www.transfermarkt.com/", url.strip())
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme.lower() not in {"http", "https"}:
            continue
        if PLACEHOLDER.search(parsed.path):
            continue
        if (parsed.hostname or "").lower() not in {
            "img.a.transfermarkt.technology", "tmssl.akamaized.net"
        }:
            continue
        return url
    return None


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
        for domain in ("transfermarkt.com", "transfermarkt.nl", "transfermarkt.co.uk", "transfermarkt.world", "transfermarkt.us"):
            urls.append("https://www.%s/%s/profil/spieler/%s" % (domain, slug, player_id))
    urls.append(PROFILE % player_id)
    return list(dict.fromkeys(urls))


def get_profile(card):
    transient = False
    profile_without_portrait = None
    for url in profile_urls(card):
        html = get(url)
        if html and portrait_url(html):
            get_profile.last_failure = None
            return html
        # Do not stop at the first regional page that only contains the profile
        # shell. Another regional host may expose the actual portrait markup.
        if html and has_profile_content(html):
            profile_without_portrait = html
        elif html:
            # A 200 response without expected profile markup may be an interstitial
            # or parser regression, so keep it retryable rather than calling it no-data.
            transient = True
        elif str(get.last_failure or "").startswith(("transient", "blocked")):
            transient = True

    if transient:
        get_profile.last_failure = "transient"
        return None
    if profile_without_portrait:
        get_profile.last_failure = "no_data"
        return profile_without_portrait
    get_profile.last_failure = "no_data"
    return None


def get(url):
    get.last_failure = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=10) as fh:
                return fh.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            # 403/404/410 are permanent for this URL; get_profile tries other
            # regional hosts. Do not turn a complete set of permanent responses
            # into a transport failure that exhausts the queue's retry budget.
            if exc.code in {404, 410}:
                get.last_failure = "permanent_http"
                return None
            if exc.code == 403:
                get.last_failure = "blocked_http"
                return None
            if attempt + 1 == RETRIES:
                get.last_failure = "transient_http"
                return None
            time.sleep(PAUSE * 3 * (attempt + 1))
        except Exception:                                        # noqa: BLE001
            if attempt + 1 == RETRIES:
                get.last_failure = "transient"
                return None
            time.sleep(PAUSE * 3 * (attempt + 1))
    get.last_failure = "transient"
    return None


def rotate_candidates(rows, offset, limit):
    if offset < 0:
        raise ValueError("offset must be non-negative")
    if rows and offset:
        start = offset % len(rows)
        rows = rows[start:] + rows[:start]
    return rows[:limit] if limit else rows


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="сколько карточек (0 — все)")
    ap.add_argument("--offset", type=int, default=0, help="сдвиг окна кандидатов для ежедневной ротации")
    ap.add_argument("--only", default="", help="обработать один Transfermarkt ID")
    args = ap.parse_args()
    if args.only and not args.only.isdigit():
        raise SystemExit("--only должен быть числовым Transfermarkt ID")
    apply_ = os.environ.get("APPLY") == "1"
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        raise SystemExit("нужны SUPABASE_URL и SUPABASE_KEY")

    # ⚠️ ТОЛЬКО ИГРОКИ. У клуба на TM своя эмблема, но эмблемы в этом проекте
    # берутся с ESPN и решение это принято владельцем; подменять их отсюда
    # значило бы откатывать его молча.
    rows = read_all("cards", {"select": "id,name,name_en,transfermarkt_id,photo_url",
                              "category": "eq.player", "active": "is.true",
                              "transfermarkt_id": ("eq." + args.only) if args.only else "not.is.null",
                              "order": "id"})

    # Existing data can be a blank string as well as SQL NULL.
    rows = [row for row in rows if not str(row.get("photo_url") or "").strip()]
    if args.only:
        rows = [row for row in rows if str(row.get("transfermarkt_id") or "") == args.only]

    # The queue tries Soccer Wiki first and verifies its write. A linked Soccer Wiki
    # row is not proof that it contains a usable portrait: if its URL is empty,
    # a placeholder, or unreachable, Transfermarkt must remain a valid fallback.
    # The per-card worker calls this collector only after checking whether the
    # card already received a reachable portrait from an earlier source.

    try:
        rows = rotate_candidates(rows, args.offset, args.limit)
    except ValueError as exc:
        raise SystemExit(str(exc))
    print("Карточек без фото, где Transfermarkt — единственный источник: %d  (APPLY=%s)"
          % (len(rows), "да" if apply_ else "нет — сухой прогон"), flush=True)
    if not rows:
        return

    found = placeholder = lost = no_profile = written = 0
    batch = []

    def flush():
        """Запись ПО ХОДУ: оборванный прогон обязан оставить сделанное."""
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
            if str(getattr(get_profile, "last_failure", "transient")).startswith(("transient", "blocked")):
                lost += 1
            else:
                no_profile += 1
        else:
            url = portrait_url(html)
            if url and not image_reachable(url):
                # Не записываем битый URL в карточку: иначе повторная задача
                # увидит непустой photo_url и может оставить его навсегда.
                lost += 1
            elif url:
                found += 1
                batch.append((card["id"], url))
            else:
                # A valid profile with a default silhouette or no image is a
                # confirmed source miss, not a transport failure.
                no_profile += 1
                if meta_image_url(html):
                    placeholder += 1
        if len(batch) >= WRITE_BATCH:
            flush()
        if i % 25 == 0:
            print("  %d/%d, портретов %d, заглушек %d, потеряно %d"
                  % (i, len(rows), found, placeholder, lost), flush=True)
        time.sleep(PAUSE)

    flush()
    print("-" * 70)
    print("Портретов найдено : %d" % found)
    print("Заглушек отвергнуто: %d" % placeholder)
    print("Записано          : %d" % written)
    print("Профилей без доступного портрета: %d" % no_profile)
    if lost:
        # ⚠️ Потеря — это НЕ «фото нет». Транспортный сбой или неожиданный
        # HTML требует повтора; подтверждённые 403/404/410 — нет данных сейчас.
        print("⚠️ ПРОФИЛЕЙ ПОТЕРЯНО: %d — повторить прогон" % lost)
    if not apply_:
        print("\nСухой прогон. APPLY=1 — записать.")
    elif lost and written == 0:
        raise SystemExit("Profile fetches were lost; retry this job after backoff.")



if __name__ == "__main__":
    main()
