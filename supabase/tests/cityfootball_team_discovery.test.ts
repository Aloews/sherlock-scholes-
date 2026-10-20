import { parseCityFootballTeamPage, teamIdFromPrompt } from "../functions/smart-deck-builder/cityfootball.ts";

Deno.test("resolves the user's SMB request to the verified archived team profile", () => {
  const id = teamIdFromPrompt("любительская команда smb из лиги city football");
  if (id !== "25194") throw new Error("SMB team alias was not resolved");
  if (teamIdFromPrompt("Manchester City")) throw new Error("non-CityFootball request was incorrectly resolved");
});

Deno.test("parses SMB team crest and preserves only source-backed fields", () => {
  const html = String.raw`<html><head>
    <title>SMB | CityFootball</title>
    <meta name="description" content="Любительская команда SMB" />
  </head><body>
    <h1>SMB</h1>
    <a href="/team/25194/profile/info"><img src="https://hb.bizmrg.com/st.cityfootball.ru/team/25194/logo/61e799fa758b0_400x400.jpg" alt="Лого команды SMB"></a>
    <a href="/player/143154">Игрок один</a>
  </body></html>`;
  const team = parseCityFootballTeamPage(html, "25194");
  if (!team) throw new Error("SMB team profile was not parsed");
  if (team.name !== "SMB") throw new Error("wrong team name");
  if (team.sourceKey !== "cityfootball:team:25194") throw new Error("wrong canonical team key");
  if (team.logoUrl !== "https://hb.bizmrg.com/st.cityfootball.ru/team/25194/logo/61e799fa758b0_400x400.jpg") throw new Error("team crest URL was not accepted");
  if (team.sourceUrl !== "https://league.cityfootball.ru/team/25194/profile/info") throw new Error("wrong source URL");
  if (Object.keys(team.stats).length) throw new Error("stats must not be invented when absent");
});
