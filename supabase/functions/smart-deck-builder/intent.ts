type PositionIntent = { pattern: string; tags: string[] };
export function positionIntent(prompt: string): PositionIntent | null {
  if (/\b(goalkeepers?|keepers?)\b|вратар|голкипер/i.test(prompt)) {
    return { pattern: "%врат%", tags: ["goalkeeper", "keeper", "gk", "вратарь", "вратари", "голкипер"] };
  }
  if (/\b(defenders?)\b|защитник|защитники/i.test(prompt)) {
    return { pattern: "%защит%", tags: ["defender", "defence", "защитник", "защитники"] };
  }
  if (/\b(midfielders?)\b|полузащитник|опорник/i.test(prompt)) {
    return { pattern: "%полузащит%", tags: ["midfielder", "midfield", "полузащитник", "опорник"] };
  }
  if (/\b(strikers?|forwards?)\b|нападающ|форвард/i.test(prompt)) {
    return { pattern: "%нападающ%", tags: ["striker", "forward", "нападающий", "форвард"] };
  }
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
  if (/\bwomen|women's football|female players\b|женщин[а-яё]* футбол|футболистк/i.test(prompt)) return "woman";
  if (/\bplayers?\b|footballers?\b|игрок[а-яё]*|футболист[а-яё]*/i.test(prompt)) return "player";
  return null;
}

export function matchesExplicitIntent(card: { category: string; position_ru: string | null; tags: string[] | null }, prompt: string): boolean {
  const position = positionIntent(prompt);
  const category = categoryIntent(prompt);
  if (position) {
    if (card.category !== "player") return false;
    const metadata = [card.position_ru ?? "", ...(card.tags ?? [])].join(" ").toLocaleLowerCase();
    if (/вратар|голкипер|goalkeeper|keeper/i.test(prompt)) return /вратар|голкипер|goalkeeper|keeper/i.test(metadata) || metadata.split(/[^a-z0-9]+/i).includes("gk");
    if (/защитник|защитники|defender/i.test(prompt)) return /защит|defender|defence/i.test(metadata);
    if (/полузащитник|опорник|midfielder/i.test(prompt)) return /полузащит|опорник|midfielder|midfield/i.test(metadata);
    return /нападающ|форвард|striker|forward/i.test(metadata);
  }
  return !category || card.category === category;
}
