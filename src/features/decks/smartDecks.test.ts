import { describe, expect, it } from 'vitest';
import { buildGoldenEra, hasCurrentClubEvidence, isFootballNewsUrl, matchNewsToPlayers, normalizeFootballText, selectBreakoutPlayers, type CanonicalPlayer, type NewsHeadline, type PlayerTrendCandidate } from './smartDecks';
import { normalizeFilter } from '@/shared/types/deck';
const players: CanonicalPlayer[] = [
 { id:'messi', name:'Лионель Месси', name_en:'Lionel Messi', photo_url:null, country:'AR', position_ru:'Нападающий', fame:100 },
 { id:'salah', name:'Мохамед Салах', name_en:'Mohamed Salah', photo_url:null, country:'EG', position_ru:'Нападающий', fame:90 },
 { id:'pedro', name:'João Pedro', name_en:'Joao Pedro', photo_url:null, country:'BR', position_ru:null, fame:60 },
];
const headlines: NewsHeadline[] = [
 { title:'Lionel Messi sets another record', url:'https://example.test/messi', source:'Example', published_at:'2026-10-12T08:00:00Z' },
 { title:'Mohamed Salah returns to training', url:'https://example.test/salah', source:'Example', published_at:'2026-10-12T07:00:00Z' },
 { title:'The match preview discusses Pedro', url:'https://example.test/pedro', source:'Example', published_at:'2026-10-12T06:00:00Z' },
];
describe('football-only news and verified form', () => {
 it('rejects hockey and other non-football news sections before entity matching', () => {
   expect(isFootballNewsUrl('https://www.sport-express.ru/hockey/nhl/news/story')).toBe(false);
   expect(isFootballNewsUrl('https://www.sport-express.ru/basketball/nba/news/story')).toBe(false);
   expect(isFootballNewsUrl('https://example.test/football/news/story')).toBe(true);
   expect(isFootballNewsUrl('not-a-url')).toBe(false);
 });
 it('requires recent match evidence to agree with the card current club', () => {
   const evidence = [
     { card_id: 'farense-card', home_team: 'Santos', away_team: 'Flamengo', disputed: false },
     { card_id: 'santos-card', home_team: 'Santos', away_team: 'Flamengo', disputed: false },
   ];
   expect(hasCurrentClubEvidence({ card_id: 'farense-card', club_key: 'farense' }, evidence)).toBe(false);
   expect(hasCurrentClubEvidence({ card_id: 'santos-card', club_key: 'santos' }, evidence)).toBe(true);
 });
});

describe('smart deck entity matching', () => {
 it('normalizes accents and punctuation', () => expect(normalizeFootballText('João-Pedro')).toBe('joao pedro'));
 it('matches full canonical names but not surname-only fragments', () => expect(matchNewsToPlayers(headlines, players).map(x=>x.id)).toEqual(['messi','salah']));
 it('never links hockey coverage to football player cards', () => {
   const hockey: NewsHeadline[] = [{ title: 'Lionel Messi mentioned in an NHL story', url: 'https://www.sport-express.ru/hockey/nhl/news/story', source: 'Example', published_at: '2026-10-12T08:00:00Z' }];
   expect(matchNewsToPlayers(hockey, players)).toEqual([]);
 });
 it('deduplicates a card across multiple headlines', () => expect(matchNewsToPlayers([...headlines, headlines[0]], players).filter(x=>x.id==='messi')).toHaveLength(1));
 it('returns no candidate when a headline only contains a surname', () => expect(matchNewsToPlayers([headlines[2]], players)).toEqual([]));
 it('matches full player names in verified article summaries, not only headlines', () => {
   const summaryOnly: NewsHeadline[] = [{
     title: 'Transfer update ahead of the weekend',
     url: 'https://example.test/summary',
     source: 'Example',
     published_at: '2026-10-12T08:00:00Z',
     description: 'The report confirms Mohamed Salah returned to training with Liverpool.',
   }];
   expect(matchNewsToPlayers(summaryOnly, players).map(x => x.id)).toEqual(['salah']);
 });
 it('can fill a 20-card news deck when 20 canonical players are evidenced', () => {
   const manyPlayers: CanonicalPlayer[] = Array.from({ length: 25 }, (_, i) => ({
     ...players[0],
     id: `player-${i}`,
     name: `Player Number ${i}`,
     name_en: null,
   }));
   const oneStory: NewsHeadline[] = [{
     title: 'A broad tournament story',
     url: 'https://example.test/tournament',
     source: 'Example',
     published_at: '2026-10-12T08:00:00Z',
     summary_short: manyPlayers.slice(0, 23).map(p => p.name).join(', '),
   }];
   expect(matchNewsToPlayers(oneStory, manyPlayers, 20)).toHaveLength(20);
 });

});

describe('golden-era deck selection', () => {
  it('selects players with a verified overlapping career at the same club', () => {
    const squad = [
      { ...players[0], legend_career: { clubs: [{ club: 'AC Milan', years: '1988–1992' }] } },
      { ...players[1], legend_career: { clubs: [{ club: 'AC Milan', years: '1989–1994' }] } },
      { ...players[2], legend_career: { clubs: [{ club: 'AC Milan', years: '1990–1993' }] } },
    ];
    const era = buildGoldenEra(squad);
    expect(era?.club).toBe('AC Milan');
    expect(era?.startYear).toBe(1990);
    expect(era?.endYear).toBe(1992);
    expect(era?.players).toHaveLength(3);
  });

  it('does not invent an era from non-overlapping careers', () => {
    const squad = [
      { ...players[0], legend_career: { clubs: [{ club: 'AC Milan', years: '1980–1984' }] } },
      { ...players[1], legend_career: { clubs: [{ club: 'AC Milan', years: '1985–1988' }] } },
      { ...players[2], legend_career: { clubs: [{ club: 'AC Milan', years: '1989–1993' }] } },
    ];
    expect(buildGoldenEra(squad)).toBeNull();
  });
});

describe('exact-card deck filter', () => {
  it('deduplicates and sorts canonical card IDs before they reach the RPC', () => {
    expect(normalizeFilter({ categories: ['player'], card_ids: ['b', 'a', 'b'], lang: 'ru' }))
      .toEqual({ categories: ['player'], card_ids: ['a', 'b'], lang: 'ru' });
  });
});

  it('rejects player timelines that overlap across different clubs', () => {
    const squad = [
      { ...players[0], legend_career: { clubs: [
        { club: 'Manchester United', years: '2003–2022' },
        { club: 'Real Madrid', years: '2009–2018' },
      ] } },
      { ...players[1], legend_career: { clubs: [{ club: 'Manchester United', years: '2006–2018' }] } },
      { ...players[2], legend_career: { clubs: [{ club: 'Manchester United', years: '2004–2017' }] } },
    ];
    expect(buildGoldenEra(squad)).toBeNull();
  });


describe('data-driven breakout deck ranking', () => {
  const trend = (overrides: Partial<PlayerTrendCandidate> = {}): PlayerTrendCandidate => ({
    id: 'p1', name: 'Player One', name_en: 'Player One', photo_url: null,
    country: 'GB', position_ru: 'Нападающий', fame: 50,
    recent_matches: 6, recent_goals: 5, recent_assists: 2,
    previous_matches: 6, previous_goals: 1, previous_assists: 0,
    recent_points: 34, previous_points: 4, recent_last_match: '2026-10-10',
    stats_collected_at: new Date().toISOString(),
    ...overrides,
  });

  it('ranks genuine per-match improvement using the two 30-day windows', () => {
    const strong = trend({ id: 'strong', name: 'Strong', recent_points: 34, previous_points: 4 });
    const weak = trend({ id: 'weak', name: 'Weak', recent_points: 14, previous_points: 10 });
    expect(selectBreakoutPlayers([weak, strong]).map((p) => p.id)).toEqual(['strong']);
  });

  it('requires enough matches in both windows and a meaningful absolute lift', () => {
    expect(selectBreakoutPlayers([
      trend({ id: 'tiny-sample', recent_matches: 2 }),
      trend({ id: 'no-lift', recent_points: 14, previous_points: 10 }),
      trend({ id: 'no-history', previous_matches: 0 }),
    ])).toEqual([]);
  });

  it('returns only canonical supplied rows and caps a deck at 20 cards', () => {
    const rows = Array.from({ length: 30 }, (_, i) => trend({
      id: `p${i}`, name: `Player ${i}`, recent_points: 100 - i, previous_points: 0,
    }));
    expect(selectBreakoutPlayers(rows, 40)).toHaveLength(20);
    expect(selectBreakoutPlayers(rows, 20).every((row) => rows.some((source) => source.id === row.id))).toBe(true);
  });
});
