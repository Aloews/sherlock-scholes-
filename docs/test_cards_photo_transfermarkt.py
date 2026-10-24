from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cards_photo_transfermarkt as collector


def check(label, actual, expected):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main():
    candidates = [{"id": str(i)} for i in range(5)]
    check("candidate rotation", [row["id"] for row in collector.rotate_candidates(candidates, 2, 2)], ["2", "3"])
    check("candidate rotation wraps", [row["id"] for row in collector.rotate_candidates(candidates, 4, 3)], ["4", "0", "1"])
    check("candidate rotation empty", collector.rotate_candidates([], 9, 3), [])
    check("slug profile URL", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[0], "https://www.transfermarkt.com/youssef-chermiti/profil/spieler/670688")
    check("regional fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[2], "https://www.transfermarkt.co.uk/youssef-chermiti/profil/spieler/670688")
    check("Dutch fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[1], "https://www.transfermarkt.nl/youssef-chermiti/profil/spieler/670688")
    check("world fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[3], "https://www.transfermarkt.world/youssef-chermiti/profil/spieler/670688")
    check("US fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[4], "https://www.transfermarkt.us/youssef-chermiti/profil/spieler/670688")
    check("ID-only fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[5], "https://www.transfermarkt.com/-/profil/spieler/670688")
    standard = '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg?lm=1">'
    check("standard og:image", collector.portrait_url(standard),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg?lm=1")

    profile_img = '<img class="data-header__profile-image" src="https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg">'
    check("profile image element fallback", collector.portrait_url(profile_img),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg")
    lazy_profile_img = '<img data-src="https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg" class="data-header__profile-image">'
    check("lazy profile image fallback", collector.portrait_url(lazy_profile_img),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg")
    nested_srcset = '<div class="data-header__profile-image"><picture><source srcset="//img.a.transfermarkt.technology/portrait/big/670688-123456.jpg 1x, //img.a.transfermarkt.technology/portrait/big/670688-654321.jpg 2x"><img src="https://img.a.transfermarkt.technology/portrait/big/default.jpg"></picture></div>'
    check("nested picture srcset with protocol-relative URLs", collector.portrait_url(nested_srcset),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg")
    lazy_srcset = '<div class="data-header__profile-image"><img data-srcset="//img.a.transfermarkt.technology/portrait/big/670688-123456.jpg 1x" src="/portrait/big/default.jpg"></div>'
    check("lazy srcset normalized", collector.portrait_url(lazy_srcset),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg")
    unrelated_img = '<img class="team-logo" src="https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg">'
    check("unrelated image element rejected", collector.portrait_url(unrelated_img), None)
    placeholder_profile_img = '<img class="data-header__profile-image" src="https://img.a.transfermarkt.technology/portrait/big/default.jpg">'
    check("placeholder profile element rejected", collector.portrait_url(placeholder_profile_img), None)

    reversed_attrs = "<meta content='https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg' property='og:image'>"
    check("reversed attrs and single quotes", collector.portrait_url(reversed_attrs),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg")

    twitter = '<meta content="https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg?x=1&amp;y=2" name="twitter:image">'
    check("twitter image fallback", collector.portrait_url(twitter),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg?x=1&y=2")

    placeholder = '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/default.jpg?lm=1">'
    check("placeholder rejected", collector.portrait_url(placeholder), None)
    check("missing image rejected", collector.portrait_url("<html><head></head></html>"), None)
    unrelated = '<meta property="og:image" content="https://example.com/player.jpg">'
    check("unrelated image host rejected", collector.portrait_url(unrelated), None)
    check("empty content rejected", collector.portrait_url('<meta property="og:image" content="">'), None)
    check("valid profile detected", collector.has_profile_content('<div class="data-header__market-value-wrapper"></div>'), True)
    check("interstitial rejected", collector.has_profile_content("<html><title>Just a moment...</title></html>"), False)

    forbidden = collector.urllib.error.HTTPError(
        "https://www.transfermarkt.com/marlon/profil/spieler/273236", 403, "Forbidden", {}, None
    )
    with patch("cards_photo_transfermarkt.urllib.request.urlopen", side_effect=forbidden), patch(
        "cards_photo_transfermarkt.time.sleep"
    ) as sleep:
        check("permanent HTTP 403 rejected", collector.get(
            "https://www.transfermarkt.com/marlon/profil/spieler/273236"
        ), None)
        check("HTTP 403 is classified as blocked", collector.get.last_failure, "blocked_http")
        check("HTTP 403 is not retried immediately", sleep.call_count, 0)

    with patch("cards_photo_transfermarkt.urllib.request.urlopen", side_effect=forbidden), patch(
        "cards_photo_transfermarkt.time.sleep"
    ):
        check("all blocked profile responses yield no page",
              collector.get_profile({"name_en": "Marlon", "transfermarkt_id": "273236"}), None)
        check("blocked profile remains retryable",
              collector.get_profile.last_failure, "transient")

    test_regional_fallback_after_portraitless_shell()
    test_no_portrait_is_confirmed_no_data()
    test_placeholder_profile_is_confirmed_no_data()
    test_transfermarkt_remains_fallback_for_soccerwiki_linked_players()
    test_unreachable_portrait_is_not_written()
    print("ok: Transfermarkt portrait parser, permanent no-data classification and fallback")


def test_regional_fallback_after_portraitless_shell():
    first_page = '<div class="data-header__profile-container"><span>Player profile</span></div>'
    second_page = '<div class="data-header__profile-container"><img class="header-photo" src="//img.a.transfermarkt.technology/portrait/big/123456-123.jpg"></div>'
    requested = []

    def fake_get(url):
        requested.append(url)
        fake_get.last_failure = None
        return first_page if url == "first" else second_page

    fake_get.last_failure = None
    with patch.object(collector, "get", fake_get), patch.object(
        collector, "profile_urls", return_value=["first", "second"]
    ):
        html = collector.get_profile({"name_en": "Test Player", "transfermarkt_id": "123456"})

    check("regional fallback continues after profile shell", requested, ["first", "second"])
    check("nested profile container portrait", collector.portrait_url(html),
          "https://img.a.transfermarkt.technology/portrait/big/123456-123.jpg")
    check("regional fallback result is not a retryable failure", collector.get_profile.last_failure, None)
    check("regional attempt diagnostics", len(collector.get_profile.last_attempts), 2)
    check("regional diagnostics record portrait hit", any("portrait=1" in item for item in collector.get_profile.last_attempts), True)


def test_no_portrait_is_confirmed_no_data():
    rows = [{
        "id": "player-card-id",
        "name": "Unavailable Player",
        "name_en": "Unavailable Player",
        "transfermarkt_id": "123456",
        "photo_url": None,
    }]
    with patch.dict("os.environ", {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_KEY": "test-key",
        "APPLY": "1",
    }), patch.object(collector, "read_all", return_value=rows), patch.object(
        collector, "get_profile", return_value=None
    ) as get_profile, patch.object(collector.time, "sleep"), patch(
        "sys.argv", ["cards_photo_transfermarkt.py", "--only", "123456"]
    ):
        get_profile.last_failure = "no_data"
        get_profile.last_attempts = [
            "transfermarkt.com:permanent_http",
            "transfermarkt.nl:permanent_http",
        ]
        output = StringIO()
        with redirect_stdout(output):
            collector.main()

    text = output.getvalue()
    check("no-data result does not exhaust the queue retry budget",
          "ПРОФИЛЕЙ ПОТЕРЯНО" in text, False)
    check("permanent no-data count", "Профилей без доступного портрета: 1" in text, True)
    check("explicit zero-photo result", "Портретов найдено : 0" in text, True)
    check("regional HTTP diagnostics are retained",
          "Regional portrait requests: transfermarkt.com:permanent_http | transfermarkt.nl:permanent_http" in text,
          True)


def test_placeholder_profile_is_confirmed_no_data():
    rows = [{
        "id": "player-card-id",
        "name": "Placeholder Player",
        "name_en": "Placeholder Player",
        "transfermarkt_id": "123456",
        "photo_url": None,
    }]
    valid_profile_with_silhouette = (
        '<div class="data-header__market-value-wrapper"></div>'
        '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/default.jpg?lm=1">'
    )
    with patch.dict("os.environ", {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_KEY": "test-key",
        "APPLY": "1",
    }), patch.object(collector, "read_all", return_value=rows), patch.object(
        collector, "get_profile", return_value=valid_profile_with_silhouette
    ), patch.object(collector.time, "sleep"), patch(
        "sys.argv", ["cards_photo_transfermarkt.py", "--only", "123456"]
    ):
        output = StringIO()
        with redirect_stdout(output):
            collector.main()

    text = output.getvalue()
    check("placeholder-only profile does not fail the queue job",
          "ПРОФИЛЕЙ ПОТЕРЯНО" in text, False)
    check("placeholder is explicitly rejected", "Заглушек отвергнуто: 1" in text, True)
    check("placeholder-only profile is no-data",
          "Профилей без доступного портрета: 1" in text, True)
    check("zero portraits are reported", "Портретов найдено : 0" in text, True)


def test_unreachable_portrait_is_not_written():
    rows = [{
        "id": "player-card-id",
        "name": "Unreachable Player",
        "name_en": "Unreachable Player",
        "transfermarkt_id": "123456",
        "photo_url": None,
    }]
    portrait = '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/123456-123.jpg">'
    with patch.dict("os.environ", {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_KEY": "test-key",
        "APPLY": "1",
    }), patch.object(collector, "read_all", return_value=rows), patch.object(
        collector, "get_profile", return_value=portrait
    ), patch.object(collector, "image_reachable", return_value=False), patch.object(
        collector, "sb"
    ) as sb, patch.object(collector.time, "sleep"), patch(
        "sys.argv", ["cards_photo_transfermarkt.py", "--only", "123456"]
    ):
        output = StringIO()
        try:
            with redirect_stdout(output):
                collector.main()
        except SystemExit as exc:
            check("unreachable portrait fails as retryable", exc.code != 0, True)
        else:
            raise AssertionError("unreachable portrait should request a retry")

    check("unreachable portrait never writes photo fields",
          not any(call.args and call.args[0] == "cards" and call.kwargs.get("method") == "PATCH"
                  for call in sb.call_args_list), True)
    check("unreachable portrait is reported as lost",
          "ПРОФИЛЕЙ ПОТЕРЯНО: 1" in output.getvalue(), True)


def test_transfermarkt_remains_fallback_for_soccerwiki_linked_players():
    rows = [{
        "id": "player-card-id",
        "name": "Example Player",
        "name_en": "Example Player",
        "transfermarkt_id": "123456",
        "photo_url": None,
    }]
    portrait = '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/123456-123.jpg">'
    with patch.dict("os.environ", {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_KEY": "test-key",
        "APPLY": "0",
    }), patch.object(collector, "read_all", return_value=rows) as read_all, patch.object(
        collector, "get_profile", return_value=portrait
    ) as get_profile, patch.object(collector.time, "sleep"), patch(
        "sys.argv", ["cards_photo_transfermarkt.py", "--only", "123456"]
    ):
        collector.main()

    check("only the card table is queried; Soccer Wiki linkage does not suppress fallback",
          read_all.call_count, 1)
    check("Transfermarkt profile attempted for linked player", get_profile.call_count, 1)


if __name__ == "__main__":
    main()
