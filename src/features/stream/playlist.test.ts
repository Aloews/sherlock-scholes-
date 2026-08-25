import { describe, it, expect } from 'vitest';
import { parseM3u, isPlayable, isSport, sportChannels, type Channel } from './playlist';

// Строки взяты из БОЕВОГО ответа VITE_STREAM_URL, а не придуманы: именно его
// форма и сломала экран, поэтому проверять надо её, а не удобный образец.
const REAL = `#EXTM3U url-tvg="http://iptvx.one/epg/epg.xml.gz"
#EXTINF:-1,🛠Ревизия №-2 🚦24.08.2026|17-20|👍iptv.org.ua💰
http://cdn10.live-tv.od.ua:8081/leonovtv/test-abr/playlist.m3u8


#EXTINF:-1 group-title="KINO ZAL",Анаконда 2025 США|екшн|пригоди|комедія
https://zetvideo.net/content/stream/films/anaconda_2025/hls/1080/index.m3u8
#EXTINF:-1 group-title="SPORT 🏆",Setanta Sports 1 HD
https://stream8.cinerama.uz/1263/tracks-v1a1/mono.m3u8
#EXTINF:-1 group-title="SPORT 🏆",Матч ТВ
http://37.230.164.98:8080/matchtv/index.m3u8
#EXTINF:-1 group-title="SPORT 🏆",Red Bull TV
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master_1660.m3u8
`;

describe('parseM3u', () => {
  it('reads every entry, films and channels alike', () => {
    const all = parseM3u(REAL);
    expect(all).toHaveLength(5);
  });

  it('takes the name from after the comma, attributes from before it', () => {
    const [first] = parseM3u('#EXTINF:-1 group-title="SPORT 🏆",Red Bull TV\nhttps://a/b.m3u8');
    expect(first).toEqual<Channel>({
      name: 'Red Bull TV',
      group: 'SPORT 🏆',
      logo: null,
      url: 'https://a/b.m3u8',
    });
  });

  it('reads tvg-logo when the playlist carries one', () => {
    const [c] = parseM3u(
      '#EXTINF:-1 tvg-logo="https://cdn/logo.png" group-title="SPORT",Eurosport\nhttps://a/b.m3u8',
    );
    expect(c.logo).toBe('https://cdn/logo.png');
  });

  // Это ровно та ошибка, ради которой адрес ищется циклом, а не lines[i + 1]:
  // в боевом файле после записи попадаются пустые строки.
  it('finds the url past blank lines, not only on the next line', () => {
    const [c] = parseM3u('#EXTINF:-1 group-title="SPORT",X\n\n\nhttps://a/b.m3u8');
    expect(c.url).toBe('https://a/b.m3u8');
  });

  it('skips comment lines between the entry and its url', () => {
    const [c] = parseM3u('#EXTINF:-1 group-title="SPORT",X\n#EXTGRP:SPORT\nhttps://a/b.m3u8');
    expect(c.url).toBe('https://a/b.m3u8');
  });

  // Запись без адреса не должна «съесть» адрес следующей — иначе канал
  // получит чужой поток, а это хуже, чем его отсутствие.
  it('drops an entry with no url instead of stealing the next one', () => {
    const out = parseM3u(
      '#EXTINF:-1 group-title="SPORT",Broken\n#EXTINF:-1 group-title="SPORT",Good\nhttps://a/b.m3u8',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Good', url: 'https://a/b.m3u8' });
  });

  it('ignores an entry with no comma and no name', () => {
    expect(parseM3u('#EXTINF:-1 group-title="SPORT"\nhttps://a/b.m3u8')).toEqual([]);
    expect(parseM3u('#EXTINF:-1 group-title="SPORT",\nhttps://a/b.m3u8')).toEqual([]);
  });

  it('survives an empty body and a header-only playlist', () => {
    expect(parseM3u('')).toEqual([]);
    expect(parseM3u('#EXTM3U url-tvg="http://x/epg.xml.gz"')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const [c] = parseM3u('#EXTINF:-1 group-title="SPORT",X\r\nhttps://a/b.m3u8\r\n');
    expect(c.url).toBe('https://a/b.m3u8');
  });

  it('leaves the group empty rather than guessing when there is no group-title', () => {
    const [c] = parseM3u('#EXTINF:-1,Ревизия\nhttps://a/b.m3u8');
    expect(c.group).toBe('');
  });
});

describe('isPlayable', () => {
  const at = (url: string): Channel => ({ name: 'X', group: 'SPORT', logo: null, url });

  it('accepts https', () => {
    expect(isPlayable(at('https://a/b.m3u8'))).toBe(true);
  });

  // 96 из 127 спортивных каналов боевого плейлиста именно такие: в https-
  // странице Mini App они не загрузятся никогда.
  it('rejects http — mixed content never loads inside the Mini App', () => {
    expect(isPlayable(at('http://37.230.164.98:8080/matchtv/index.m3u8'))).toBe(false);
  });

  it('rejects a protocol-relative url, which the player cannot resolve either', () => {
    expect(isPlayable(at('//a/b.m3u8'))).toBe(false);
  });

  it('does not accept https as a substring somewhere later in the url', () => {
    expect(isPlayable(at('http://a/redirect?to=https://b/c.m3u8'))).toBe(false);
  });
});

describe('isSport', () => {
  const inGroup = (group: string): Channel => ({ name: 'X', group, logo: null, url: 'https://a' });

  it('matches the playlist group as it is spelled today', () => {
    expect(isSport(inGroup('SPORT 🏆'))).toBe(true);
  });

  // Ради этого проверка по подстроке, а не равенство: группы в этом плейлисте
  // переименовывают руками.
  it('survives the group being renamed or translated', () => {
    expect(isSport(inGroup('Спорт'))).toBe(true);
    expect(isSport(inGroup('Sport HD'))).toBe(true);
    expect(isSport(inGroup('FUTBOL'))).toBe(true);
    expect(isSport(inGroup('Футбол'))).toBe(true);
  });

  it('rejects the groups that must never reach a football game', () => {
    expect(isSport(inGroup('KINO ZAL'))).toBe(false);
    expect(isSport(inGroup('♥18+'))).toBe(false);
    expect(isSport(inGroup('Фильмы-VPN'))).toBe(false);
    expect(isSport(inGroup(''))).toBe(false);
  });
});

describe('sportChannels', () => {
  it('keeps only sport channels that can actually play', () => {
    const out = sportChannels(REAL);
    expect(out.map((c) => c.name)).toEqual(['Setanta Sports 1 HD', 'Red Bull TV']);
  });

  it('drops films even when they are served over https', () => {
    expect(sportChannels(REAL).some((c) => c.group === 'KINO ZAL')).toBe(false);
  });

  // «Матч ТВ» лежит в боевом плейлисте трижды; в списке это выглядит багом.
  it('collapses repeats of the same url', () => {
    const twice = [
      '#EXTINF:-1 group-title="SPORT",Матч ТВ',
      'https://a/match.m3u8',
      '#EXTINF:-1 group-title="SPORT 🏆",Матч HD',
      'https://a/match.m3u8',
    ].join('\n');
    expect(sportChannels(twice)).toHaveLength(1);
  });

  it('keeps two different urls that share a name', () => {
    const two = [
      '#EXTINF:-1 group-title="SPORT",KHL',
      'https://a/1028.m3u8',
      '#EXTINF:-1 group-title="SPORT",KHL',
      'https://a/1422.m3u8',
    ].join('\n');
    expect(sportChannels(two)).toHaveLength(2);
  });

  it('returns nothing rather than throwing on a playlist that failed to load', () => {
    expect(sportChannels('')).toEqual([]);
    expect(sportChannels('<html>404 Not Found</html>')).toEqual([]);
  });
});
