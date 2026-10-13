import { categoryIntent, matchesExplicitIntent, positionIntent } from "../functions/smart-deck-builder/intent.ts";

Deno.test("goalkeeper-only requests exclude non-goalkeepers", () => {
  const prompt = "только вратари";
  if (positionIntent(prompt)?.pattern !== "%врат%") throw new Error("position intent");
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
