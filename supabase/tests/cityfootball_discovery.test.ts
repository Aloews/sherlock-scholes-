import {
  cityFootballPlayerIdsFromPage,
  cityFootballTeamUrlFromPage,
  parseCityFootballPlayerPage,
} from "../functions/smart-deck-builder/cityfootball.ts";

Deno.test("parses a verified CityFootball player profile without inventing missing data", () => {
  const html = `
    <html>
      <head>
        <title>Иван Иванов | CityFootball</title>
        <meta property="og:title" content="Иван Иванов | CityFootball" />
        <meta property="og:image" content="https://hb.bizmrg.com/st.cityfootball.ru/player/143154/photo/143154.jpg" />
        <meta name="description" content="Игрок команды Тест ФК" />
      </head>
      <body>
        <a href="/team/25480/profile/info">Тест ФК</a>
        <p>Позиция: Защитник</p>
        <p>Матчей: 12</p><p>Голы: 3</p><p>Ассисты: 2</p>
      </body>
    </html>`;
  const player = parseCityFootballPlayerPage(html, "143154");
  if (!player) throw new Error("profile not parsed");
  if (player.name !== "Иван Иванов") throw new Error("wrong player name");
  if (player.sourceKey !== "cityfootball:player:143154") throw new Error("source key not stable");
  if (player.teamName !== "Тест ФК") throw new Error("team name not parsed");
  if (player.photoUrl !== "https://league.cityfootball.ru/uploads/player/143154.jpg") throw new Error("photo not parsed");
  if (player.stats.matches !== 12 || player.stats.goals !== 3 || player.stats.assists !== 2) throw new Error("stats not parsed");
  if (player.bornOn !== null) throw new Error("birth date must remain unknown");
});

Deno.test("extracts unique player links and the canonical team page", () => {
  const html = `
    <a href="/player/143154">Иван Иванов</a>
    <a href="https://league.cityfootball.ru/player/143155">Пётр Петров</a>
    <a href="/player/143154">Иван Иванов</a>
    <a href="/team/25480/profile/info">Тест ФК</a>`;
  const ids = cityFootballPlayerIdsFromPage(html);
  if (ids.length !== 2 || ids[0] !== "143154" || ids[1] !== "143155") throw new Error("player IDs not deduplicated");
  if (cityFootballTeamUrlFromPage(html) !== "https://league.cityfootball.ru/team/25480/profile/info") throw new Error("team URL not parsed");
});
