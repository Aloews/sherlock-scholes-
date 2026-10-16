from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cards_photo_transfermarkt as collector


def check(label, actual, expected):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main():
    check("current profile URL", collector.PROFILE % "28003", "https://www.transfermarkt.com/-/profil/spieler/28003")
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
    check("empty content rejected", collector.portrait_url('<meta property="og:image" content="">'), None)
    check("valid profile detected", collector.has_profile_content('<div class="data-header__market-value-wrapper"></div>'), True)
    check("interstitial rejected", collector.has_profile_content("<html><title>Just a moment...</title></html>"), False)
    print("ok: Transfermarkt portrait metadata parser")


if __name__ == "__main__":
    main()
