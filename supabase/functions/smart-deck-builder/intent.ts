type PositionIntent = { pattern: string; tags: string[] };
const WOMEN_PLAYER_REQUEST = /футболистк|женщин[а-яё]*\s+футбол|женск[а-яё]*\s+футбол|women'?s football|female players?|women players?/i;
export function positionIntent(prompt: string): PositionIntent | null {
  if (/\b(goalkeepers?|keepers?)\b|вратар|голкипер/i.test(prompt)) return { pattern: "position_ru.ilike.%врат%,position_ru.ilike.%goalkeeper%,position_ru.ilike.%keeper%", tags: ["goalkeeper", "keeper", "gk", "вратарь", "вратари", "голкипер"] };
  if (/\b(defenders?)\b|защитник|защитники/i.test(prompt)) return { pattern: "position_ru.ilike.%защит%,position_ru.ilike.%defend%,position_ru.ilike.%back%,position_ru.ilike.%centre-back%,position_ru.ilike.%center-back%,position_ru.ilike.%full-back%", tags: ["defender", "defence", "defense", "centre-back", "center-back", "full-back", "fullback", "left-back", "right-back", "wing-back", "cb", "lb", "rb", "lwb", "rwb", "защитник", "защитники"] };
  if (/\b(midfielders?)\b|полузащитник|опорник/i.test(prompt)) return { pattern: "position_ru.ilike.%полузащит%,position_ru.ilike.%midfield%,position_ru.ilike.%defensive midfield%", tags: ["midfielder", "midfield", "defensive midfielder", "central midfielder", "attacking midfielder", "dm", "cm", "am", "полузащитник", "опорник"] };
  if (/\b(strikers?|forwards?)\b|нападающ|форвард/i.test(prompt)) return { pattern: "position_ru.ilike.%нападающ%,position_ru.ilike.%forward%,position_ru.ilike.%striker%,position_ru.ilike.%winger%", tags: ["striker", "forward", "centre-forward", "center-forward", "winger", "cf", "st", "lw", "rw", "нападающий", "форвард"] };
  return null;
}
export function categoryIntent(prompt: string): string | null {
  if (/\bcoaches?\b|тренер/i.test(prompt)) return "coach";
  if (/\breferees?\b|арбитр|судь[яи]/i.test(prompt)) return "referee";
  if (/\bstadiums?\b|стадион/i.test(prompt)) return "stadium";
  if (/club nicknames?|прозвищ[а-яё]* клуб|клубн[а-яё]* прозвищ/i.test(prompt)) return "club_nickname";
  if (/commentators?|комментатор/i.test(prompt)) return "commentator";
  if (/\bderbies?\b|дерби/i.test(prompt)) return "derby";
  if (/\btrophies?\b|кубк[а-яё]*|трофе[йи]/i.test(prompt)) return "trophy";
  if (/football terms?|terms?\b|термин[а-яё]*|поняти[а-яё]* футбола/i.test(prompt)) return "term";
  if (/\bclubs?\b|клуб[а-яё]*$/i.test(prompt)) return "club";
  if (/\beras?\b|эпох[а-яё]*/i.test(prompt)) return "era";
  if (/\bpositions?\b|позици[а-яё]* игрок/i.test(prompt)) return "position";
  if (WOMEN_PLAYER_REQUEST.test(prompt)) return "player";
  if (/\bwomen\b|женщин[а-яё]*$/i.test(prompt)) return "woman";
  if (/\bplayers?\b|footballers?\b|игрок[а-яё]*|футболист[а-яё]*/i.test(prompt)) return "player";
  return null;
}
export function matchesExplicitIntent(card: { category: string; position_ru: string | null; tags: string[] | null }, prompt: string): boolean {
  const womenRequested = WOMEN_PLAYER_REQUEST.test(prompt);
  const position = positionIntent(prompt);
  const category = categoryIntent(prompt);
  if (womenRequested) {
    if (card.category === "woman") return true;
    if (card.category !== "player") return false;
    const tags = (card.tags ?? []).map((tag) => tag.toLocaleLowerCase());
    if (!tags.some((tag) => ["women", "female", "women's", "female-player"].includes(tag))) return false;
  }
  if (position) {
    if (card.category !== "player") return false;
    const metadata = [card.position_ru ?? "", ...(card.tags ?? [])].join(" ").toLocaleLowerCase();
    if (/вратар|голкипер|goalkeeper|keeper/i.test(prompt)) return /вратар|голкипер|goalkeeper|keeper/i.test(metadata) || metadata.split(/[^a-z0-9]+/i).includes("gk");
    if (/защитник|защитники|defender/i.test(prompt)) return /защит|defend|defence|defense|centre.?back|center.?back|full.?back|left.?back|right.?back|wing.?back|\b(cb|lb|rb|lwb|rwb)\b/i.test(metadata);
    if (/полузащитник|опорник|midfielder/i.test(prompt)) return /полузащит|опорник|midfielder|midfield|\b(dm|cm|am)\b/i.test(metadata);
    return /нападающ|форвард|striker|forward|centre.?forward|center.?forward|winger|\b(cf|st|lw|rw)\b/i.test(metadata);
  }
  return !category || card.category === category || (womenRequested && category === "player" && card.category === "woman");
}
