import {
  createQuizCallback,
  formatQuizFacts,
  gamesMenuKeyboard,
  gamesMenuRichBlocks,
  parseQuizCallback,
  parseQuizRound,
  questionRichBlocks,
  resultRichBlocks,
} from "./rich-quiz.ts";

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
];
const round = {
  answer_id: ids[0],
  facts: { position: "Forward", birth_year: 1990, height_cm: 180, clubs_count: 4 },
  options: ids.map((id, index) => ({ id, name: `Player ${index + 1}` })),
};

Deno.test("parses a valid quiz round and rejects a leaked/malformed shape", () => {
  const parsed = parseQuizRound([round]);
  if (!parsed || parsed.options.length !== 4 || parsed.answer_id !== ids[0]) {
    throw new Error("valid round was not parsed");
  }
  if (parseQuizRound({ ...round, options: round.options.slice(0, 2) }) !== null) {
    throw new Error("round with fewer than four options must be rejected");
  }
  if (parseQuizRound({ ...round, answer_id: ids[0].replace("1", "z") }) !== null) {
    throw new Error("invalid answer id must be rejected");
  }
});

Deno.test("formats known facts in Russian and English without inventing missing facts", () => {
  const ru = formatQuizFacts({ position: "Forward", birth_year: 1990 }, "ru");
  const en = formatQuizFacts({ position: "Forward", birth_year: 1990 }, "en");
  if (ru.length !== 2 || !ru[0].startsWith("Позиция:") || !en[0].startsWith("Position:")) {
    throw new Error("fact labels are not localized");
  }
  if (formatQuizFacts({}, "ru").length !== 0) throw new Error("empty facts must stay empty");
});

Deno.test("quiz callbacks fit Telegram's 64-byte limit and round-trip", () => {
  const answer = createQuizCallback("answer", "0123456789abcdef", 0);
  if (new TextEncoder().encode(answer).length > 64) throw new Error("callback_data exceeds 64 bytes");
  const parsedAnswer = parseQuizCallback(answer);
  if (parsedAnswer?.action !== "answer" || parsedAnswer.optionIndex !== 0) {
    throw new Error("answer callback did not round-trip");
  }
  const next = createQuizCallback("next", "0123456789abcdef");
  if (parseQuizCallback(next)?.action !== "next") throw new Error("next callback did not round-trip");
  if (parseQuizCallback("sq:a:bad:bad") !== null) throw new Error("malformed callback must be rejected");
});

Deno.test("rich quiz messages contain one callback button per option and no answer key", () => {
  const blocks = questionRichBlocks(round, "0123456789abcdef", "ru");
  const buttons = blocks.filter((block) => block.type === "buttons");
  if (buttons.length !== 4) throw new Error(`expected four answer buttons, got ${buttons.length}`);
  if (JSON.stringify(blocks).includes(round.answer_id)) {
    throw new Error("correct answer id must not be exposed in the outgoing question");
  }
  const result = resultRichBlocks(true, "Player 1", "0123456789abcdef", "ru");
  if (!JSON.stringify(result).includes("Следующий вопрос")) throw new Error("next action missing");
});

Deno.test("games hub exposes only the three existing mini-games through HTTPS Web App buttons", () => {
  const blocks = gamesMenuRichBlocks("https://sherlock-scholes.vercel.app/", "ru");
  const buttons = blocks.filter((block) => block.type === "buttons");
  if (buttons.length !== 3) throw new Error(`expected three mini-game buttons, got ${buttons.length}`);
  const serialized = JSON.stringify(blocks);
  for (const game of ["quiz", "famous", "squad"]) {
    if (!serialized.includes(`/minigames?game=${game}`)) throw new Error(`missing ${game} route`);
  }
  if (serialized.includes("http://")) throw new Error("insecure Web App URL emitted");
  const fallback = gamesMenuKeyboard("https://sherlock-scholes.vercel.app", "en");
  if (!Array.isArray((fallback as { inline_keyboard?: unknown }).inline_keyboard)) {
    throw new Error("fallback inline keyboard missing");
  }
  let rejected = false;
  try { gamesMenuRichBlocks("http://example.com", "ru"); } catch { rejected = true; }
  if (!rejected) throw new Error("non-HTTPS APP_URL must be rejected");
});
