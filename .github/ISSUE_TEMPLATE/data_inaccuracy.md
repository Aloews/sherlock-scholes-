---
name: Data inaccuracy
about: A wrong or duplicated card in the deck (player/club/coach/etc.)
title: "[data] "
labels: data-quality
---

<!-- The deck is production content. See docs/DATA_QUALITY_STANDARD.md. -->

## Card(s) affected
<!-- Name(s) and category. Paste the CSV row(s) if you have them. -->

## What's wrong
- [ ] Wrong facts (club / season / position / nationality / national team)
- [ ] Duplicate player (same person, twice / across categories)
- [ ] Wrong difficulty
- [ ] Bad `forbidden_words`
- [ ] Junk / placeholder card
- [ ] Other:

## Correct value / source
<!-- What it should be, and a source (Wikidata QID, Wikipedia, etc.). -->

## Fix path
<!-- Data edit + regenerate? Scraper/pipeline change? Product decision (e.g.
which category a dual-role person belongs to)? -->

<!-- The fix must be locked by a data-integrity test: a failing test that pins
this inaccuracy, then the correction, then green. Do not edit the CSV silently. -->
