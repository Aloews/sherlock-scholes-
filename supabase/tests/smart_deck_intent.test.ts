import { categoryIntent, matchesExplicitIntent, positionIntent } from "../functions/smart-deck-builder/intent.ts";

Deno.test("goalkeeper-only requests exclude non-goalkeepers", () => {
  const prompt = "только вратари";
  if (!positionIntent(prompt)?.pattern.includes("position_ru.ilike.%врат%")) throw new Error("position intent");
  if (!matchesExplicitIntent({ category: "player", position_ru: "Вратарь", tags: [] }, prompt)) throw new Error("goalkeeper rejected");
  if (matchesExplicitIntent({ category: "player", position_ru: "Защитник", tags: [] }, prompt)) throw new Error("defender accepted");
  if (matchesExplicitIntent({ category: "club", position_ru: null, tags: [] }, prompt)) throw new Error("club accepted");
});

Deno.test("explicit categories are enforced", () => {
  const prompt = "Тренеры сборных";
  if (categoryIntent(prompt) !== "coach") throw new Error("coach category");
  if (!matchesExplicitIntent({ category: "coach", position_ru: null, tags: [] }, prompt)) throw new Error("coach rejected");
  if (matchesExplicitIntent({ category: "player", position_ru: "Вратарь", tags: [] }, prompt)) throw new Error("player accepted");
});

Deno.test("women footballer prompts resolve to player cards and reject men's cards", () => {
  if (categoryIntent("Футболистки России") !== "player") throw new Error("women intent must be players");
  if (!matchesExplicitIntent({ category: "player", position_ru: null, tags: ["women", "female"] }, "Футболистки России")) throw new Error("verified women player rejected");
  if (matchesExplicitIntent({ category: "player", position_ru: null, tags: ["footballer"] }, "Футболистки России")) throw new Error("unverified gender accepted");
});

Deno.test("defender requests include English full-backs and centre-backs", () => {
  const prompt = "защитники Брайтона";
  const intent = positionIntent(prompt);
  if (!intent?.pattern.includes("position_ru.ilike.%back%")) throw new Error("English defender positions missing");
  if (!intent.tags.includes("centre-back") || !intent.tags.includes("left-back")) throw new Error("defender tags incomplete");
  if (!matchesExplicitIntent({ category: "player", position_ru: "Centre-Back", tags: [] }, prompt)) throw new Error("centre-back rejected");
  if (!matchesExplicitIntent({ category: "player", position_ru: "Right-Back", tags: [] }, prompt)) throw new Error("right-back rejected");
  if (matchesExplicitIntent({ category: "player", position_ru: "Winger", tags: [] }, prompt)) throw new Error("winger accepted as defender");
});
