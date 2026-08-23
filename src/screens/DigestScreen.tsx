import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconPlayerPlayFilled } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import {
  fetchDigestSummary, fetchGoals, fetchWeekendGoals, fetchWeekGoals, fetchLiveMatches,
  type DigestSummary, type GoalClip, type WeekendGoal, type RankedClip, type LiveMatch,
} from '@/features/digest/digestApi';
import { ClipCard } from '@/features/digest/ClipCard';
import { LiveNow } from '@/features/digest/LiveNow';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
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
  // Пустой массив — начальное значение, а не `null`: раздела «идёт сейчас» при
  // пустом списке не бывает вовсе, поэтому различать «ещё не пришло» и «ничего
  // не идёт» здесь нечем и незачем — оба показываются одинаково: никак.
  const [live, setLive] = useState<LiveMatch[]>([]);
  // null — «все чемпионаты». Не пустое множество: пустое пришлось бы всюду
  // читать как «ничего не выбрано, значит показать всё», и одна забытая
  // проверка превратила бы фильтр в пустой экран.
  const [league, setLeague] = useState<string | null>(null);
  // `null` — кнопку ещё не нажимали. Это не «пусто» и не «грузится»: секция
  // до первого нажатия показывает кнопку, а не результат.
  const [summary, setSummary] = useState<LoadState<DigestSummary> | null>(null);

  const lang = feedLanguage(i18n.language);

  /**
   * Сводка собирается ТОЛЬКО отсюда, по нажатию.
   *
   * Не в useEffect — потому что это единственная секция экрана, которая стоит
   * денег: текст пишет языковая модель. Расход при этом ограничен на сервере
   * отпечатком набора тем, а не здесь; задача экрана — не звать функцию
   * самому и не давать нажать второй раз, пока идёт первый.
   */
  const makeSummary = async () => {
    if (summary?.status === 'loading') return;
    hapticImpact('light');
    setSummary(LOADING);
    setSummary(await fetchDigestSummary(lang));
  };

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
    run(fetchLiveMatches(), setLive);
    return () => { cancelled = true; };
  }, [lang]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  );

  const open = (url: string) => { hapticImpact('light'); openLink(url); };

  /**
   * Чемпионаты — ИЗ САМИХ РОЛИКОВ, а не из списка в коде.
   *
   * channel у клипа и есть чемпионат: конвейер берёт их с официальных каналов
   * лиг, поэтому там ровно «Premier League», «LALIGA», «Serie A», «Ligue 1»,
   * «UEFA». Заводить рядом второй перечень значило бы держать список лиг в
   * двух местах и однажды их разойти.
   *
   * Фильтр общий на оба раздела: чемпионат — свойство ролика, а не раздела, и
   * два отдельных фильтра означали бы, что «Серия А» вверху и внизу могут
   * показывать разное.
   */
  const leagues = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of [...(weekend ?? []), ...(week ?? [])]) {
      count.set(c.channel, (count.get(c.channel) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [weekend, week]);

  const only = <T extends { channel: string }>(list: T[] | null): T[] =>
    league === null ? list ?? [] : (list ?? []).filter((c) => c.channel === league);

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
        {/* Чемпионаты. Лента горизонтальная и общая на оба раздела: чемпионат
            — свойство ролика, а не раздела. Число на чипе — чтобы выбор не был
            вслепую, иначе половина ведёт в список из одного ролика. */}
        {leagues.length > 1 && (
          <div className="-mx-4 px-4 overflow-x-auto">
            <div className="flex gap-1.5 w-max pb-0.5">
              <Chip
                label={t('matches.all_leagues')}
                selected={league === null}
                onClick={() => { hapticImpact('light'); setLeague(null); }}
              />
              {leagues.map(([name, n]) => (
                <Chip
                  key={name}
                  label={`${name} · ${n}`}
                  selected={league === name}
                  onClick={() => { hapticImpact('light'); setLeague(league === name ? null : name); }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ─── Идёт сейчас ───
            Первым, потому что это единственный раздел, который перестанет быть
            верным, пока читатель листает. Сам раздел исчезает, когда показывать
            нечего, — а нечего будет чаще, чем есть: см. LiveNow.tsx. */}
        <LiveNow matches={live} />

        {/* ─── Краткая суть ───
            По кнопке, а не при открытии экрана: текст пишет языковая модель.
            Четыре исхода показываются РАЗНО — готовый текст, «сегодня тихо»
            (тем нет вовсе), отказ модели и поломка. Свести их в одну надпись
            значило бы повторить ошибку, ради которой в проекте заведён
            LoadState: «тихо» и «сломалось» выглядели бы одинаково. */}
        <section className="space-y-2">
          <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
            {t('digest.summary')}
          </p>

          {summary === null && (
            <>
              <p className="text-brand-muted text-[10.5px]">{t('digest.summary_note')}</p>
              <Button variant="secondary" size="sm" fullWidth onClick={makeSummary}>
                {t('digest.summary_make')}
              </Button>
            </>
          )}

          {summary?.status === 'loading' && (
            <p className="text-brand-muted text-sm py-4">{t('digest.summary_loading')}</p>
          )}

          {summary?.status === 'error' && (
            <>
              <p className="text-red-400 text-sm py-2">{t('digest.summary_failed')}</p>
              <Button variant="secondary" size="sm" fullWidth onClick={makeSummary}>
                {t('digest.summary_retry')}
              </Button>
            </>
          )}

          {summary?.status === 'ok' && summary.data.status === 'no_topics' && (
            <p className="text-brand-muted text-sm py-2">{t('digest.summary_quiet')}</p>
          )}

          {summary?.status === 'ok' && summary.data.status === 'refused' && (
            <p className="text-brand-muted text-sm py-2">{t('digest.summary_refused')}</p>
          )}

          {summary?.status === 'ok' && summary.data.status === 'ok' && (
            <p className="text-white text-sm leading-relaxed whitespace-pre-line">
              {summary.data.summary}
            </p>
          )}
        </section>

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

            {only(weekend).map((clip) => <ClipCard key={clip.video_id} clip={clip} />)}
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
            {only(week).map((clip) => <ClipCard key={clip.video_id} clip={clip} />)}
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
                <span className="block text-white text-sm">{clip.title_generated ?? clip.title}</span>
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
