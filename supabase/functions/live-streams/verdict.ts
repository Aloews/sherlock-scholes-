// Чистая часть live-streams: разбор страницы и разбор ответа API.
//
// ⚠️ ОТДЕЛЬНЫМ ФАЙЛОМ РАДИ ПРОВЕРЯЕМОСТИ, А НЕ РАДИ СЛОЁВ. `index.ts`
// вызывает `Deno.serve` на загрузке модуля: импортировать его из vitest нельзя
// вовсе — падает на первой строке. Правила же, ради которых всё затевалось,
// чистые: строка HTML на входе, приговор на выходе. Здесь они и живут, и
// здесь их гоняет `test/live_streams_verdict.test.ts`.
//
// Почему именно эти два правила разделены так — в шапке `index.ts`: страница
// отвечает «какой ролик», API отвечает «идёт ли он». Прежняя версия пыталась
// получить оба ответа от страницы и получала неверный.

/** Что API сказал про ролик. Ровно три исхода, четвёртого нет. */
export type State = "live" | "upcoming" | "over";

export interface Verdict {
  state: State;
  title: string;
  started_at: string | null;
  scheduled_start_at: string | null;
}

/**
 * На какой ролик указывает страница `/live` канала.
 *
 * ⚠️ ЗДЕСЬ БОЛЬШЕ НЕТ ПРОВЕРКИ «ИДЁТ ЛИ ЭФИР», И ЭТО НЕ ОСЛАБЛЕНИЕ. Проверка
 * была, выглядела как два условия — и оба ошибались: `"isLiveNow":true` не
 * встречается даже на вечных эфирах (замер 13.09.2026: Sky News, NASA, DW,
 * Bloomberg, Lofi Girl — ноль вхождений), а `"isLive":true` стоит и под
 * анонсом. Страница честно отвечает ровно на один вопрос — КАКОЙ это ролик, —
 * и функция спрашивает только его.
 *
 * Canonical, а не первый попавшийся `videoId`: на странице их десятки — все
 * полки канала, — и только canonical указывает на тот ролик, ради которого
 * YouTube развернул `/live`. Когда разворачивать нечего, canonical не ролик
 * (наблюдалось буквальное `href="undefined"`), и кандидата просто нет.
 */
export function candidateVideoId(html: string): string | null {
  const m = html.match(
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
  );
  return m ? m[1] : null;
}

/**
 * Разбор ОДНОГО элемента ответа `videos.list` в приговор.
 *
 * ⚠️ РЕШАЮТ ДВЕ ОТМЕТКИ ВРЕМЕНИ, А НЕ СЛОВО. Рядом в ответе лежит
 * `snippet.liveBroadcastContent` со значениями live/upcoming/none, и соблазн
 * читать его велик — но это пересказ, а `actualStartTime`/`actualEndTime` —
 * сам факт: «начался в» и «кончился в». Пересказ отстаёт, факт нет.
 *
 * `liveStreamingDetails` нет вовсе — значит это обычный ролик, а не эфир: в
 * разделе про идущие матчи ему делать нечего ни в каком виде.
 */
export function verdictOf(item: unknown): Verdict | null {
  const it = item as {
    snippet?: { title?: unknown };
    liveStreamingDetails?: {
      actualStartTime?: unknown;
      actualEndTime?: unknown;
      scheduledStartTime?: unknown;
    };
  };
  const title = typeof it?.snippet?.title === "string" ? it.snippet.title : "";
  const d = it?.liveStreamingDetails;
  if (!title || !d) return null;

  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const started = str(d.actualStartTime);
  const ended = str(d.actualEndTime);
  const scheduled = str(d.scheduledStartTime);

  if (ended) return { state: "over", title, started_at: started, scheduled_start_at: scheduled };
  if (started) return { state: "live", title, started_at: started, scheduled_start_at: scheduled };
  if (scheduled) {
    return { state: "upcoming", title, started_at: null, scheduled_start_at: scheduled };
  }
  // Эфир без единой отметки времени — ни начатый, ни назначенный. Такого в
  // выдаче не встречалось; если встретится, он не «идёт» и не «скоро».
  return null;
}
