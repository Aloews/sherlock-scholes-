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
    })[1], "https://www.transfermarkt.co.uk/youssef-chermiti/profil/spieler/670688")
    check("world fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[2], "https://www.transfermarkt.world/youssef-chermiti/profil/spieler/670688")
    check("US fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[3], "https://www.transfermarkt.us/youssef-chermiti/profil/spieler/670688")
    check("ID-only fallback", collector.profile_urls({
        "name_en": "Youssef Chermiti", "transfermarkt_id": "670688"
    })[4], "https://www.transfermarkt.com/-/profil/spieler/670688")
    standard = '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg?lm=1">'
    check("standard og:image", collector.portrait_url(standard),
          "https://img.a.transfermarkt.technology/portrait/big/670688-123456.jpg?lm=1")

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
        check("permanent HTTP 403 is not retried", sleep.call_count, 0)
    test_transfermarkt_remains_fallback_for_soccerwiki_linked_players()
    print("ok: Transfermarkt portrait metadata parser and linked-player fallback")


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
