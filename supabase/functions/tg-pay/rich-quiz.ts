export interface QuizOption {
  id: string;
  name: string;
}

export interface QuizFacts {
  position?: string;
  height_cm?: number;
  birth_year?: number;
  clubs_count?: number;
  national_team?: string;
  national_caps?: number;
  tournaments?: string[];
}

export interface QuizRound {
  answer_id: string;
  facts: QuizFacts;
  options: QuizOption[];
}

export interface QuizCallback {
  action: "answer" | "next";
  sessionKey: string;
  optionId?: string;
}

export type RichBlock = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_KEY = /^[0-9a-f]{16}$/;

export function parseQuizRound(value: unknown): QuizRound | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const candidate = row as Record<string, unknown>;
  if (typeof candidate.answer_id !== "string" || !UUID.test(candidate.answer_id)) return null;
  if (!candidate.facts || typeof candidate.facts !== "object" || Array.isArray(candidate.facts)) return null;
  if (!Array.isArray(candidate.options) || candidate.options.length !== 4) return null;
  const options = candidate.options.map((item) => {
    if (!item || typeof item !== "object") return null;
    const option = item as Record<string, unknown>;
    if (typeof option.id !== "string" || !UUID.test(option.id) || typeof option.name !== "string") return null;
    return { id: option.id, name: option.name };
  });
  if (options.some((option) => option === null)) return null;
  if (!options.some((option) => option!.id === candidate.answer_id)) return null;
  return {
    answer_id: candidate.answer_id,
    facts: candidate.facts as QuizFacts,
    options: options as QuizOption[],
  };
}

export function formatQuizFacts(facts: QuizFacts, language: string): string[] {
  const ru = language.toLowerCase().startsWith("ru");
  const lines: string[] = [];
  if (facts.position) lines.push(ru ? `Позиция: ${facts.position}` : `Position: ${facts.position}`);
  if (facts.birth_year) lines.push(ru ? `Год рождения: ${facts.birth_year}` : `Born: ${facts.birth_year}`);
  if (facts.height_cm) lines.push(ru ? `Рост: ${facts.height_cm} см` : `Height: ${facts.height_cm} cm`);
  if (facts.clubs_count) lines.push(ru ? `Клубов в карьере: ${facts.clubs_count}` : `Career clubs: ${facts.clubs_count}`);
  if (facts.national_team) lines.push(ru ? `Сборная: ${facts.national_team}` : `National team: ${facts.national_team}`);
  if (facts.national_caps) lines.push(ru ? `Матчей за сборную: ${facts.national_caps}` : `National caps: ${facts.national_caps}`);
  if (facts.tournaments?.length) {
    lines.push(ru ? `Турниры: ${facts.tournaments.slice(0, 3).join(", ")}` : `Tournaments: ${facts.tournaments.slice(0, 3).join(", ")}`);
  }
  return lines;
}

export function createQuizCallback(action: "answer" | "next", sessionKey: string, optionId?: string): string {
  if (!SESSION_KEY.test(sessionKey)) throw new Error("Invalid quiz session key");
  if (action === "answer") {
    if (!optionId || !UUID.test(optionId)) throw new Error("Invalid quiz option id");
    const value = `sq:a:${sessionKey}:${optionId}`;
    if (new TextEncoder().encode(value).length > 64) throw new Error("Quiz callback exceeds Telegram limit");
    return value;
  }
  return `sq:n:${sessionKey}`;
}

export function parseQuizCallback(value: unknown): QuizCallback | null {
  if (typeof value !== "string") return null;
  const answer = /^sq:a:([0-9a-f]{16}):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(value);
  if (answer) return { action: "answer", sessionKey: answer[1], optionId: answer[2] };
  const next = /^sq:n:([0-9a-f]{16})$/i.exec(value);
  if (next) return { action: "next", sessionKey: next[1] };
  return null;
}

export function questionRichBlocks(round: QuizRound, sessionKey: string, language: string): RichBlock[] {
  const ru = language.toLowerCase().startsWith("ru");
  const facts = formatQuizFacts(round.facts, language);
  const blocks: RichBlock[] = [
    { type: "heading", size: 2, text: ru ? "Угадай футболиста" : "Guess the player" },
    { type: "paragraph", text: ru ? "Кто это? Открывай факты и выбирай игрока." : "Who is it? Read the clues and choose the player." },
    ...facts.map((text) => ({ type: "paragraph", text })),
    { type: "divider" },
  ];
  for (const option of round.options) {
    blocks.push({
      type: "buttons",
      buttons: [{
        text: option.name,
        style: "primary",
        callback_data: createQuizCallback("answer", sessionKey, option.id),
      }],
      align: "center",
    });
  }
  return blocks;
}

export function resultRichBlocks(
  correct: boolean,
  answerName: string,
  sessionKey: string,
  language: string,
): RichBlock[] {
  const ru = language.toLowerCase().startsWith("ru");
  return [
    { type: "heading", size: 2, text: correct ? (ru ? "Верно!" : "Correct!") : (ru ? "Не угадал" : "Not quite") },
    { type: "paragraph", text: ru ? `Это ${answerName}.` : `The answer is ${answerName}.` },
    {
      type: "buttons",
      buttons: [{
        text: ru ? "Следующий вопрос" : "Next question",
        style: "success",
        callback_data: createQuizCallback("next", sessionKey),
      }],
      align: "center",
    },
  ];
}
