import { describe, it, expect } from 'vitest';
import {
  candidateVideoId,
  verdictOf,
} from '../supabase/functions/live-streams/verdict';

/**
 * «ИДЁТ СЕЙЧАС» ОБЯЗАНО ЗНАЧИТЬ «ИДЁТ СЕЙЧАС».
 *
 * ⚠️ ЭТО ПРОВЕРКА ПО СЛЕДАМ ЖИВОЙ ПОЛОМКИ, А НЕ ПО ГИПОТЕЗЕ. Раздел дайджеста
 * подписывал «идёт сейчас» восемь трансляций, ни одна из которых не шла;
 * человек открывал ссылку и читал «трансляция начнётся через 2 дня».
 * Владелец назвал это издевательством.
 *
 * Причина — признак эфира брался со страницы канала:
 *
 *   if (!/"isLiveNow"\s*:\s*true/.test(html) && !/"isLive"\s*:\s*true/.test(html))
 *
 * Замер 13.09.2026 обеих половин:
 *   `"isLiveNow":true` — НОЛЬ вхождений даже на вечных эфирах (Sky News,
 *     NASA, DW, Bloomberg, Lofi Girl), то есть половина не срабатывала никогда;
 *   `"isLive":true`   — есть на странице с АНОНСОМ, рядом с `"isUpcoming":true`
 *     и `LIVE_STREAM_OFFLINE`, то есть вторая половина срабатывала на том, что
 *     не идёт.
 *
 * Поэтому страница теперь отвечает только «какой ролик», а «идёт ли он»
 * спрашивается у `videos.list` — и проверяется здесь.
 */

/** Страница `/live` канала с АНОНСОМ — как у Concacaf 13.09.2026. */
const PAGE_UPCOMING = `
  <link rel="canonical" href="https://www.youtube.com/watch?v=WjPLbB7QUJ0">
  {"videoId":"aaaaaaaaaaa","isLive":true,"isUpcoming":true,
   "scheduledStartTime":"1789000000","reason":"LIVE_STREAM_OFFLINE"}
`;

/**
 * Страница канала, на которой разворачивать нечего. `href="undefined"` — не
 * выдумка для теста: ровно это YouTube отдал на `/live` у Sky News, NASA,
 * DW, Bloomberg и Lofi Girl, ВО ВРЕМЯ ИХ ЭФИРА.
 */
const PAGE_NO_VIDEO = `
  <link rel="canonical" href="undefined">
  {"videoId":"bbbbbbbbbbb","isLive":true,"viewCount":{"runs":[{"text":" watching now"}]}}
  {"videoId":"ccccccccccc"}
`;

const item = (
  title: string,
  details: Record<string, string> | null,
) => ({
  id: 'x'.repeat(11),
  snippet: { title, liveBroadcastContent: details?.actualStartTime ? 'live' : 'upcoming' },
  ...(details ? { liveStreamingDetails: details } : {}),
});

describe('кандидат со страницы', () => {
  it('берётся из canonical', () => {
    expect(candidateVideoId(PAGE_UPCOMING)).toBe('WjPLbB7QUJ0');
  });

  it('когда canonical не ролик — кандидата нет', () => {
    expect(candidateVideoId(PAGE_NO_VIDEO)).toBeNull();
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ К ПРЕДЫДУЩЕМУ. Если бы идентификатор брался
  // первым попавшимся `"videoId"`, эта же страница отдала бы `bbbbbbbbbbb` —
  // ролик с полки канала, к эфиру отношения не имеющий.
  it('полки канала кандидатом не считаются', () => {
    expect(candidateVideoId(PAGE_NO_VIDEO)).not.toBe('bbbbbbbbbbb');
  });
});

describe('приговор по ответу API', () => {
  it('назначен: время начала есть, факта начала нет', () => {
    const v = verdictOf(item('Violette AC vs Club Sando', {
      scheduledStartTime: '2026-09-15T18:00:00Z',
    }));
    expect(v?.state).toBe('upcoming');
    expect(v?.started_at).toBeNull();
    expect(v?.scheduled_start_at).toBe('2026-09-15T18:00:00Z');
  });

  it('идёт: факт начала есть, конца нет', () => {
    const v = verdictOf(item('MLS NEXT PRO: Chattanooga FC vs Atlanta United FC', {
      scheduledStartTime: '2026-09-13T23:00:00Z',
      actualStartTime: '2026-09-13T23:02:11Z',
    }));
    expect(v?.state).toBe('live');
    expect(v?.started_at).toBe('2026-09-13T23:02:11Z');
  });

  it('кончился: есть конец — и это уже не наш эфир', () => {
    const v = verdictOf(item('Flamengo x Corinthians', {
      actualStartTime: '2026-09-13T23:02:11Z',
      actualEndTime: '2026-09-14T01:04:00Z',
    }));
    expect(v?.state).toBe('over');
  });

  it('обычный ролик без эфира приговора не получает', () => {
    expect(verdictOf(item('Pre-Las Palmas training session', null))).toBeNull();
  });

  it('без заголовка писать нечего', () => {
    expect(verdictOf({ liveStreamingDetails: { actualStartTime: '2026-09-13T23:00:00Z' } }))
      .toBeNull();
  });

  it('мусор вместо ответа не роняет и не проходит', () => {
    for (const junk of [null, undefined, 0, '', [], { snippet: 1 }]) {
      expect(verdictOf(junk)).toBeNull();
    }
  });
});

/**
 * ⚠️ ТОТ САМЫЙ СЛУЧАЙ, ЦЕЛИКОМ. Страница «Шахтаря» 13.09.2026 несла
 * `"isLive":true` — и прежний признак объявлял эфир идущим, хотя в самом
 * заголовке написано 15.09. Пройти этот тест, вернув «идёт», нельзя.
 */
describe('анонс не может назваться идущим', () => {
  it('страница с "isLive":true даёт кандидата, а не приговор', () => {
    const id = candidateVideoId(PAGE_UPCOMING);
    expect(id).toBe('WjPLbB7QUJ0');

    const v = verdictOf(item(
      'LIVE! U21. Шахтар – Чорноморець. Пряма трансляція матчу УПЛ-2 (15.09.2026)',
      { scheduledStartTime: '2026-09-15T13:00:00Z' },
    ));
    expect(v?.state).toBe('upcoming');
    expect(v?.state).not.toBe('live');
  });
});
