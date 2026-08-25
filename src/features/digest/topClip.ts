import { fetchRecentGoals, fetchGoals, type RecentGoal, type GoalClip } from './digestApi';

/**
 * Один ролик для главного экрана — и то, ЧТО именно про него можно обещать.
 *
 * Вынесено из компонента, потому что выбор здесь не про вёрстку: «лучший гол»,
 * «лучший момент» и «свежее видео» — три разных утверждения, и подпись обязана
 * совпадать с тем, откуда строка взялась. Компонент, который сам ходит в две
 * RPC и сам решает, как это назвать, рано или поздно назовёт сейв голом.
 */

export type TopClipKind = 'goal' | 'moment' | 'fresh';

export interface TopClip {
  video_id: string;
  title: string;
  channel: string;
  thumb_url: string | null;
  /**
   * Просмотры. Есть только у роликов выходных: у дневных они настоящие тоже,
   * но раздел суточных отвечает на «что нового», и число там значило бы
   * «сколько успел набрать за час» — то есть почти ноль.
   */
  views: number | null;
  /**
   * Чем это назвать.
   *
   * `goal` — разбор заголовка сказал «гол». `moment` — не сказал, и обещать
   * гол нельзя: у прошлых выходных самым смотренным роликом был СЕЙВ с 1.3
   * млн просмотров, и он бы встал первым. `fresh` — выходных ещё нет в базе,
   * показываем свежее и говорим именно это.
   */
  kind: TopClipKind;
}

const fromRecent = (clip: RecentGoal): TopClip => ({
  video_id: clip.video_id,
  title: clip.title,
  channel: clip.channel,
  thumb_url: clip.thumb_url,
  views: clip.views,
  kind: clip.is_goal ? 'goal' : 'moment',
});

const fromDaily = (clip: GoalClip): TopClip => ({
  video_id: clip.video_id,
  title: clip.title,
  channel: clip.channel,
  thumb_url: clip.thumb_url,
  views: null,
  kind: 'fresh',
});

/**
 * Лучший ролик последних дней, а если их нет — свежий.
 *
 * ПОРЯДОК ЗАДАЁТ СЕРВЕР, клиент берёт первую строку. Пересортировать здесь
 * значило бы, что «лучшее» на главной и «лучшее» в дайджесте — разные вещи, и
 * расхождение проявилось бы только на глаз. С переходом на скользящее окно это
 * стало важнее, а не менее важно: сервер теперь чередует дни, и клиент,
 * решивший «отсортирую по просмотрам», молча вернул бы главной позавчерашнее.
 *
 * Откат на суточные ролики нужен для двух настоящих случаев: пауза на сборные
 * и первые дни жизни базы. Пустой блок на главной выглядел бы как поломка, а
 * «свежее видео» — это правда.
 */
export async function fetchTopClip(): Promise<TopClip | null> {
  const recent = await fetchRecentGoals(1);
  if (recent.length > 0) return fromRecent(recent[0]);

  const daily = await fetchGoals(1);
  if (daily.length > 0) return fromDaily(daily[0]);

  return null;
}
