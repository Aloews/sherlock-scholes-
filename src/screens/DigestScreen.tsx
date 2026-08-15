import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconPlayerPlayFilled } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import {
  fetchGoals, fetchWeekendGoals, fetchWeekGoals,
  type GoalClip, type WeekendGoal, type RankedClip,
} from '@/features/digest/digestApi';
import { ClipCard } from '@/features/digest/ClipCard';
import { watchUrl, feedLanguage } from '@/features/digest/digestFormat';

/**
 * Дайджест: голы выходных, заголовки суток и ролики суток.
 *
 * ТРИ СЕКЦИИ, ТРИ ПОРЯДКА, и каждый — то, что для этой секции измеримо.
 *
 *   Голы выходных — сначала голы, внутри по ПРОСМОТРАМ. Просмотры настоящие:
 *   Atom-фид YouTube отдаёт media:statistics и media:starRating внутри
 *   media:group, бесплатно и без ключа.
 *
 *   Заголовки — по ГРОМКОСТИ: сколько разных изданий вышло с тем же сюжетом.
 *   Вот у RSS популярности действительно нет, но громкая новость выдаёт себя
 *   тем, что её пишут все сразу.
 *
 *   Ролики суток — по ВРЕМЕНИ, и теперь это выбор, а не отсутствие данных.
 *   Просмотры у них есть, но раздел отвечает на вопрос «что нового сегодня»,
 *   а свежий ролик по определению не успел их набрать: рейтинг здесь показывал
 *   бы вчерашнее.
 *
 * ЭТА ШАПКА УЖЕ ОДИН РАЗ ВРАЛА. Она утверждала, что фид не отдаёт просмотров —
 * их просто никто не прочитал, и на этом «лучшие голы» чуть не стали
 * выдумкой. Если снова окажется, что источник умеет больше, чем здесь
 * написано, — верить источнику.
 *
 * ССЫЛКИ ОТКРЫВАЮТСЯ СНАРУЖИ, через openLink. Мини-приложение живёт в WebView,
 * и переход по внешней ссылке внутри него — это уход из игры без пути назад.
 */
export function DigestScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [goals, setGoals] = useState<GoalClip[] | null>(null);
  const [weekend, setWeekend] = useState<WeekendGoal[] | null>(null);
  const [week, setWeek] = useState<RankedClip[] | null>(null);

  const lang = feedLanguage(i18n.language);

  useEffect(() => {
    let cancelled = false;
    // КАЖДЫЙ РАЗДЕЛ ПОЯВЛЯЕТСЯ САМ, а не все сразу.
    //
    // Раньше здесь стоял Promise.all, и экран не показывал НИЧЕГО, пока не
    // ответит самый медленный из четырёх запросов. Медленный — это заголовки:
    // громкость считается при чтении и стоит около секунды, тогда как ролики
    // приходят за треть. То есть три готовых раздела ждали четвёртый, и
    // ожидание было ровно по худшему, а не по среднему.
    //
    // Отдельные промисы вместо одного: каждый setState рисует свой раздел, у
    // всех уже есть состояние загрузки, и порядок разделов на экране от
    // порядка ответов не зависит.
    const run = <T,>(p: Promise<T>, set: (v: T) => void) => {
      void p.then((v) => { if (!cancelled) set(v); });
    };
    run(fetchWeekendGoals(), setWeekend);
    run(fetchWeekGoals(), setWeek);
    run(fetchGoals(), setGoals);
    return () => { cancelled = true; };
  }, [lang]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  );

  const open = (url: string) => { hapticImpact('light'); openLink(url); };

  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }),
    [i18n.language],
  );

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('digest.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5">
        {/* ─── Голы выходных ───
            Первой секцией намеренно: это то, ради чего экран открывают раз в
            неделю. Окно — последние ЗАВЕРШИВШИЕСЯ выходные, поэтому список не
            растёт на глазах и не выдаёт половину субботы за итог. */}
        {weekend !== null && (
          <section className="space-y-2">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('digest.weekend')}
              {weekend.length > 0 && (
                <span className="normal-case">
                  {' · '}
                  {dayFmt.format(new Date(weekend[0].weekend_start))}
                  {' – '}
                  {dayFmt.format(new Date(new Date(weekend[0].weekend_end).getTime() - 1))}
                </span>
              )}
            </p>
            <p className="text-brand-muted text-[10.5px]">{t('digest.weekend_note')}</p>

            {weekend.length === 0 && (
              <p className="text-brand-muted text-sm py-4">{t('digest.empty_weekend')}</p>
            )}

            {weekend.map((clip) => <ClipCard key={clip.video_id} clip={clip} />)}
          </section>
        )}

        {/* ─── Лучшее за неделю мимо выходных ───
            РАЗДЕЛ ПОЯВИЛСЯ ИЗ-ЗА ДЫРЫ. Суперкубок Европы был скачан вовремя и
            лежал в базе, но показать его было негде: в блок выходных пятница
            не попадает, а из суточного он выпал через 24 часа. Так исчезало
            всё, что играется с понедельника по пятницу. */}
        {week !== null && week.length > 0 && (
          <section className="space-y-2">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('digest.week')}
            </p>
            <p className="text-brand-muted text-[10.5px]">{t('digest.week_note')}</p>
            {week.map((clip) => <ClipCard key={clip.video_id} clip={clip} />)}
          </section>
        )}

        {/* ─── Видео ─── */}
        <section className="space-y-2">
          <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
            {t('digest.goals')}
          </p>
          {/* Обещание ровно того, что есть: подборка каналов лиг за сутки, а
              не рейтинг. Порядок по времени здесь осознанный — см. шапку. */}
          <p className="text-brand-muted text-[10.5px]">{t('digest.goals_note')}</p>

          {goals === null && <p className="text-brand-muted text-sm py-4">{t('digest.loading')}</p>}
          {goals !== null && goals.length === 0 && (
            <p className="text-brand-muted text-sm py-4">{t('digest.empty_goals')}</p>
          )}

          {goals?.map((clip) => (
            <button
              key={clip.video_id}
              type="button"
              onClick={() => open(watchUrl(clip))}
              className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl overflow-hidden text-left hover:border-brand-accent/50 transition-colors"
            >
              {clip.thumb_url && (
                <span className="block relative">
                  <img
                    src={clip.thumb_url}
                    alt=""
                    loading="lazy"
                    className="w-full aspect-video object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-11 h-11 rounded-full bg-black/55 flex items-center justify-center">
                      <IconPlayerPlayFilled size={18} className="text-white translate-x-[1px]" />
                    </span>
                  </span>
                </span>
              )}
              <span className="block p-3">
                <span className="block text-white text-sm">{clip.title}</span>
                <span className="block text-brand-muted text-[10.5px] mt-1.5">
                  {clip.channel} · {timeFmt.format(new Date(clip.published_at))}
                </span>
              </span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
