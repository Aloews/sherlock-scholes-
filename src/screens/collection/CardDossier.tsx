import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconTrophy, IconShirt, IconFlag } from '@tabler/icons-react';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { CATEGORY_COLOR, CATEGORY_FALLBACK_COLOR } from '@/shared/ui/CategoryIcon';
import { cardDisplayName } from '@/shared/lib/cardName';
import { byLatestFirst } from '@/shared/lib/careerOrder';
import { StatLine } from '@/shared/ui/StatLine';
import { CareerStats } from './CareerStats';
import { SoccerWikiPanel } from '@/features/soccerwiki/SoccerWikiPanel';
import { splitHonours } from '@/shared/lib/honours';
import { isoToFlag } from '@/shared/lib/flag';
import { countryName, positionName } from '@/shared/lib/countryName';
import { formatEur } from '@/shared/lib/money';
import { longDateFormat } from '@/shared/lib/dateFormat';
import { formatMetric, movedMetrics } from '@/shared/lib/metricFormat';
import { careerHighlight } from '@/shared/lib/careerHighlight';
import { careerRowMeta } from '@/shared/lib/careerRowMeta';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import {
  TIER_COLOR, TIER_LABEL_RU, TIER_LABEL_EN, type Card, type CardAttributes,
} from '@/shared/types/database';
import {
  fetchCollectedTotals, fetchMetricChanges, fetchCareerTotals,
  type CollectedTotals, type MetricChange, type CareerTotalsRow,
} from '@/features/ratings/ratingsApi';
import {
  fetchClubOfCard, fetchPlayerLevel, fetchClubsByNames,
  type CardClub, type PlayerLevel, type ClubByName,
} from '@/features/clubs/clubsApi';
import {
  fetchPlayerNews, fetchPlayerClips, type PlayerNewsItem, type PlayerClip,
} from '@/features/collection/playerMediaApi';

// Full-screen card dossier, opened from the Collection grid. Follows the
// prototype's `isPlayer` overlay: framed hero card, quick-fact tiles, OVR
// badge, attribute bars, trophies, career, facts.
//
// The OVR badge and the six "Характеристики" bars only render when
// card.ovr / card.attributes carry a value — nothing seeds them yet
// (docs/cards_attributes_column.sql adds the columns; real per-player
// ratings are a separate data project, see docs/PROGRESSION_FEATURES_HANDOFF.md).
// Inventing numbers on a screen that reads as factual would be a lie, so
// absent data means the badge/bars are simply omitted, not faked.
const ATTRIBUTE_ROWS: { key: keyof CardAttributes; labelKey: string }[] = [
  { key: 'pace',      labelKey: 'collection.attr_pace' },
  { key: 'shooting',  labelKey: 'collection.attr_shooting' },
  { key: 'passing',   labelKey: 'collection.attr_passing' },
  { key: 'dribbling', labelKey: 'collection.attr_dribbling' },
  { key: 'defense',   labelKey: 'collection.attr_defense' },
  { key: 'physical',  labelKey: 'collection.attr_physical' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-brand-muted mb-2.5">
        {title}
      </p>
      {children}
    </div>
  );
}

export function CardDossier({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language;
  const isRu = lang.startsWith('ru');

  // Текущий клуб — ссылка на экран команды. Грузится молча и отдельно: у
  // легенды его нет и не должно быть, и это норма, а не поломка.
  const [club, setClub] = useState<CardClub | null>(null);
  // Клубы карьеры, разрешённые в ключи и карточки коллекции.
  const [careerClubs, setCareerClubs] = useState<Map<string, ClubByName>>(new Map());
  useEffect(() => {
    let cancelled = false;
    setClub(null);
    void fetchClubOfCard(card.id, lang).then((r) => {
      if (!cancelled && r.status === 'ok') setClub(r.data);
    });
    return () => { cancelled = true; };
  }, [card.id, lang]);

  // Собранная статистика матчей — та же таблица, что кормит рейтинг. Грузится
  // отдельно и молча: досье полно и без неё, а её отсутствие для легенды —
  // норма, а не поломка (мы собираем только действующих игроков).
  const [collected, setCollected] = useState<CollectedTotals[]>([]);
  useEffect(() => {
    let cancelled = false;
    setCollected([]);
    void fetchCollectedTotals(card.id).then((r) => {
      if (!cancelled && r.status === 'ok') setCollected(r.data);
    });
    return () => { cancelled = true; };
  }, [card.id]);

  // Итоги карьеры: матчи за сборную, число лиг, страны. Из них собирается
  // ОДНА строка под именем — см. careerHighlight.
  const [totals, setTotals] = useState<CareerTotalsRow | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTotals(null);
    void fetchCareerTotals(card.id).then((r) => {
      if (!cancelled && r.status === 'ok') setTotals(r.data[0] ?? null);
    });
    return () => { cancelled = true; };
  }, [card.id]);

  // Динамика показателей — история изменений, а не сегодняшние числа.
  //
  // ⚠️ ПОКАЗЫВАЕМ ТОЛЬКО ТО, ЧТО ДЕЙСТВИТЕЛЬНО СРАВНИЛОСЬ. Хранятся изменения,
  // и у карточки, заведённой вчера, у каждого показателя `was` пуст — «было
  // пусто, стало 600 тыс.» это не рост, это первый замер. Одиннадцать таких
  // строк в досье выглядели бы динамикой, не будучи ею.
  const [changes, setChanges] = useState<MetricChange[]>([]);
  useEffect(() => {
    let cancelled = false;
    setChanges([]);
    void fetchMetricChanges(card.id).then((r) => {
      if (!cancelled && r.status === 'ok') setChanges(r.data);
    });
    return () => { cancelled = true; };
  }, [card.id]);

  // Новости и видео — по фамилии, через ту же токенизацию, что клеит темы
  // дайджеста через алфавиты. Пусто трое суток подряд — норма: `news_items`
  // столько и живёт, а не каждый день про игрока пишут.
  const [news, setNews] = useState<PlayerNewsItem[]>([]);
  const [clips, setClips] = useState<PlayerClip[]>([]);
  useEffect(() => {
    let cancelled = false;
    setNews([]);
    setClips([]);
    void fetchPlayerNews(card.id).then((r) => { if (!cancelled) setNews(r); });
    void fetchPlayerClips(card.id).then((r) => { if (!cancelled) setClips(r); });
    return () => { cancelled = true; };
  }, [card.id]);

  const moved = movedMetrics(changes);
  const highlight = careerHighlight(totals, card.born_on);
  // ⚠️ ДАТА ФОРМАТИРУЕТСЯ ЧЕРЕЗ TRY, И ЭТО НЕ ПЕРЕСТРАХОВКА. Intl бросает
  // RangeError на непрочитанной дате и роняет ВЕСЬ экран в белый лист — так
  // уже было в FantasyScreen, и разбор этого записан ниже в этом же файле.
  const bornText = (() => {
    if (highlight?.kind !== 'born') return null;
    try {
      const d = new Date(highlight.date);
      if (Number.isNaN(d.getTime())) return null;
      return longDateFormat(lang).format(d);
    } catch {
      return null;
    }
  })();

  // Правая колонка строки карьеры. Числа, если они есть; годы, если чисел нет.
  const rowMeta = (row: { years?: string | null; apps?: number | null; goals?: number | null }) => {
    const m = careerRowMeta(row);
    // ⚠️ СВОЙ КЛЮЧ, А НЕ `career.club_line`. Тот несёт ещё и пасы, а в
    // `career_stats` из инфобокса Википедии пасов нет вовсе — подставлять туда
    // ноль значило бы утверждать «ни одной передачи за двадцать лет».
    if (m.kind === 'numbers') return t('career.row_numbers', { matches: m.apps, goals: m.goals });
    return m.kind === 'years' ? m.years : '';
  };

  const name     = cardDisplayName(card, lang);
  const catColor = CATEGORY_COLOR[card.category] ?? CATEGORY_FALLBACK_COLOR;
  const facts    = card.facts ?? null;

  const tierLabel = card.tier
    ? (isRu ? TIER_LABEL_RU : TIER_LABEL_EN)[card.tier]
    : null;

  // Уровень — ТО ЖЕ ЧИСЛО, что показывает рейтинг футболистов. Грузится
  // молча: у неигровой карточки его нет и не должно быть.
  const [level, setLevel] = useState<PlayerLevel | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLevel(null);
    void fetchPlayerLevel(card.id).then((r) => {
      if (!cancelled && r.status === 'ok') setLevel(r.data);
    });
    return () => { cancelled = true; };
  }, [card.id]);

  // Quick facts — only the tiles that actually have a value.
  const flag = isoToFlag(card.country);
  const tiles = [
    card.country && {
      label: t('collection.f_country'),
      value: `${flag ? `${flag} ` : ''}${countryName(card.country, lang) ?? card.country}`,
    },
    (card.position_ru || facts?.position) && {
      label: t('collection.f_position'),
      value: positionName(card.position_ru ?? facts?.position ?? null, lang)
        ?? (card.position_ru ?? facts?.position),
    },
    facts?.height_cm && { label: t('collection.f_height'), value: `${facts.height_cm} cm` },
    facts?.years_active && { label: t('collection.f_years'), value: facts.years_active },
    facts?.national_caps && { label: t('collection.f_caps'), value: String(facts.national_caps) },
    facts?.clubs_count && { label: t('collection.f_clubs'), value: String(facts.clubs_count) },
  ].filter(Boolean).slice(0, 4) as { label: string; value: string }[];

  // Trophies are things WON; facts.tournaments is where a player turned up.
  // The rule lives in shared/lib/honours.ts and is tested there — it used to
  // be a concatenation here, which credited players with honours they never
  // had. See honours.test.ts.
  const { trophies, tournaments } = splitHonours({
    titles: facts?.titles,
    legendTitles: card.legend_career?.titles,
    tournaments: facts?.tournaments,
  });

  // Career: legends carry clubs+years, veterans carry clubs+apps/goals.
  //
  // ⚠️ ПОРЯДОК — ОТ ПОСЛЕДНЕГО КЛУБА К ПЕРВОМУ, и он задаётся здесь, а не
  // приходит из базы. Владелец: «сортировку клубной карьеры нужно изменить,
  // не по количеству проведенных матчей, а по годам, от последнего клуба к
  // первому». Порядок из базы значил РАЗНОЕ у разных карточек: `career_stats`
  // собран по числу матчей, `legend_career` — как перечислено в статье. На
  // одном экране стояли две сортировки, и ни одна не отвечала на вопрос «где
  // он играет сейчас», ради которого карьеру и открывают.
  //
  // ⚠️ СПРАВА СТОИТ ДОСТИЖЕНИЕ, А НЕ ГОДЫ. Владелец: «года в карточке так и не
  // поменял, на лучшие достижения игрока». Матчи и голы за клуб лежат в той же
  // строке `career_stats` и до сих пор не показывались вовсе; годы отвечали на
  // вопрос «когда», а карьеру открывают ради «чего добился». Правило — в
  // `careerRowMeta`, и второй его копии здесь нет: у легенды чисел не бывает,
  // и там годы остаются.
  const career: { club: string; meta: string }[] = byLatestFirst(
    card.legend_career?.clubs?.map((c) => ({
      club: (!isRu && c.club_en) ? c.club_en : c.club,
      years: c.years,
      meta: rowMeta({ years: c.years }),
    }))
    ?? card.career_stats?.map((c) => ({
      club: (isRu && c.club_ru) ? c.club_ru : c.club,
      years: c.years,
      meta: rowMeta(c),
    }))
    ?? [],
  );

  // Клубы карьеры → ключи и карточки коллекции, ОДНИМ запросом на карточку.
  //
  // ⚠️ Хук стоит здесь, а не рядом с остальными наверху, потому что ему нужен
  // уже посчитанный `career`: список имён — это его вход. Порядок хуков от
  // этого не плавает, он один и тот же на каждый рендер.
  const careerNames = career.map((r) => r.club).join('\u0000');
  useEffect(() => {
    const names = careerNames ? careerNames.split('\u0000') : [];
    if (names.length === 0) { setCareerClubs(new Map()); return; }
    let cancelled = false;
    void fetchClubsByNames(names).then((rows) => {
      if (cancelled) return;
      setCareerClubs(new Map(rows.map((r) => [r.name, r])));
    });
    return () => { cancelled = true; };
    // Строка, а не массив: массив у React — новая ссылка на каждый рендер, и
    // запрос уходил бы бесконечно.
  }, [careerNames]);

  // Язык интерфейса, затем en, затем ru — тот же порядок, что в
  // TrainingScreen. Здесь `en` пропускали, и это стало видно, когда описания
  // поехали через enwiki: у карточки без русской статьи (Debinha, Temwa
  // Chawinga, Sophia Wilson — в ruwiki их нет вовсе) есть только английское
  // описание, и досье показывало пустоту при непустых данных.
  const blurb = card.descriptions?.[lang.slice(0, 2)]
    ?? card.descriptions?.en
    ?? card.descriptions?.ru
    ?? null;

  const attributeRows = card.attributes
    ? ATTRIBUTE_ROWS
        .map((row) => ({ label: t(row.labelKey), value: card.attributes![row.key] }))
        .filter((row): row is { label: string; value: number } => row.value != null)
    : [];

  // ИЗВЕСТНОСТЬ ДОМА И В МИРЕ — две разные величины, и показывать их надо
  // рядом. До 04.09.2026 просмотры собирались по ДЕВЯТИ локалям интерфейса, и
  // половина активных игроков (1452 из 2918) не имела ни одного просмотра на
  // языке своей страны: турка мерили по-русски, поляка по-арабски. Теперь
  // языки берутся из самой статьи, а «дома» — из языков страны игрока.
  //
  // ⚠️ Строка не рисуется, если величины нет. Ноль читался бы как «его никто
  // не знает», а значит он «мы не измерили» — это разные утверждения.
  const reachRows = [
    card.fame_home != null && { label: t('collection.fame_home'), value: card.fame_home },
    card.fame_world != null && { label: t('collection.fame_world'), value: card.fame_world },
  ].filter(Boolean) as { label: string; value: number }[];

  // ⚠️ ИСТОЧНИК СТОИМОСТИ НАЗЫВАЕТСЯ РЯДОМ С ЧИСЛОМ. Данные принадлежат
  // Transfermarkt; маскировать происхождение нельзя, и дата оценки идёт с
  // числом — источник переоценивает раз в несколько месяцев, а без даты
  // число читается как «сейчас».
  const marketValue = formatEur(card.market_value_eur, lang);
  const valuedAt = (() => {
    if (!card.market_value_at) return null;
    const d = new Date(card.market_value_at);
    // Intl бросает RangeError на непрочитанной дате и роняет ВЕСЬ экран в
    // белый лист — так уже было в FantasyScreen.
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' }).format(d);
    } catch {
      return card.market_value_at;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 bg-brand-bg ds-screen overflow-y-auto animate-slide-up">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center px-4 py-4 border-b border-brand-border bg-brand-bg">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); onClose(); }}
          aria-label={t('home.back')}
          className="p-1.5 -ml-1.5 text-brand-muted hover:text-white transition-colors"
        >
          <IconChevronLeft size={20} stroke={2} />
        </button>
        <span className="flex-1 text-center text-[12px] font-bold uppercase tracking-[0.12em] text-brand-muted mr-6">
          {t('collection.dossier')}
        </span>
      </div>

      <div className="max-w-sm mx-auto px-5 py-5 space-y-5 pb-12">
        {/* Hero — the same card the game shows, framed by rarity. */}
        <PlayerCard card={card} mode="explainer" />

        {tierLabel && (
          <p
            className="text-center text-[11px] font-bold uppercase tracking-[0.12em] -mt-2"
            style={{ color: TIER_COLOR[card.tier!] }}
          >
            {tierLabel}
          </p>
        )}

        {/* ОДНА строка о человеке — та, что есть: матчи за сборную, иначе
            число лиг, иначе дата рождения. Владелец: «в карточках стоит
            писать матчей за сборной или количество лиг, где играл игрок. Если
            эти данных нет, то дату рождения». Лестница, а не набор: показать
            всё сразу значит утопить главное. */}
        {highlight && (
          <p className="text-center text-brand-muted text-[12px] -mt-2">
            {highlight.kind === 'national' && t('collection.hl_national', {
              team: highlight.team, apps: highlight.apps, goals: highlight.goals,
            })}
            {highlight.kind === 'leagues' && t('collection.hl_leagues', {
              leagues: highlight.leagues, countries: highlight.countries,
            })}
            {highlight.kind === 'born' && bornText
              && t('collection.hl_born', { date: bornText })}
          </p>
        )}

        {card.photo_url && (
          <div
            className="relative w-full h-[180px] rounded-2xl border border-brand-border
                       bg-brand-surface overflow-hidden flex items-center justify-center"
          >
            {/* object-contain, not object-cover: source photos range from tight
                headshots to full-body shots, and a fixed-height crop was cutting
                a lot of them off. Showing the whole photo (letterboxed if needed)
                never loses the subject, at the cost of some empty space beside
                narrow ones.

                ⚠️ ПУСТОТУ ПО БОКАМ ЗАКРЫВАЕТ РАЗМЫТАЯ КОПИЯ ТОГО ЖЕ СНИМКА, а
                не обрезка. Обрезка вернула бы ровно то, из-за чего здесь и
                появился object-contain — отрезанные головы; размытая подложка
                заполняет кадр, не трогая сам портрет. Картинка одна и та же,
                браузер берёт её из кэша: второго запроса в сеть нет.

                aria-hidden и alt="" — подложка декоративна, читалке экрана её
                объявлять нечего: подпись несёт снимок сверху. */}
            <img
              src={card.photo_url}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-40"
            />
            <img
              src={card.photo_url}
              alt={name}
              className="relative max-w-full max-h-full object-contain"
            />
            {card.ovr != null && (
              <div
                role="img"
                aria-label={t('collection.ovr_aria', { value: card.ovr })}
                className="absolute top-3 left-3 w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(155deg, rgb(var(--brand-accent-soft)), rgb(var(--brand-accent)))',
                }}
              >
                <span className="ds-display text-[16px] font-extrabold text-brand-bg">{card.ovr}</span>
              </div>
            )}
          </div>
        )}

        {/* Two per row, not the prototype's four: its tiles held numbers, ours
            hold words like "Нападающий", which truncate at 390px. */}
        {tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5 text-center"
              >
                <p className="text-[13px] font-bold text-white truncate">{tile.value}</p>
                <p className="text-[9px] uppercase tracking-[0.05em] text-brand-muted mt-0.5">
                  {tile.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ВИД КАРТОЧКИ ПО SOCCER WIKI. Владелец: «вид карточки команд и
            игроков и данные взять с https://en.soccerwiki.org/». Рейтинг
            1–99, роль словом, рост, вес и рабочая нога — ни одного из этих
            полей у проекта до сих пор не было. Стоит ПЕРЕД «Характеристиками»
            намеренно: те шесть полос до сих пор пусты (`cards.attributes`
            никто не заполняет), а это — настоящие числа.

            Блок сам себя не рисует, если карточка не связана с источником. */}
        <SoccerWikiPanel cardId={card.id} />

        {attributeRows.length > 0 && (
          <Section title={t('collection.attributes')}>
            <div className="flex flex-col gap-2.5">
              {attributeRows.map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-[11.5px] mb-1">
                    <span className="text-brand-muted">{row.label}</span>
                    <span className="font-bold text-white">{row.value}</span>
                  </div>
                  <div className="h-[5px] rounded-full bg-brand-border overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${row.value}%`, background: 'var(--accent-gradient)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {(reachRows.length > 0 || marketValue) && (
          <Section title={t('collection.reach')}>
            <div className="flex flex-col gap-2.5">
              {reachRows.map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-[11.5px] mb-1">
                    <span className="text-brand-muted">{row.label}</span>
                    <span className="font-bold text-white">{row.value}</span>
                  </div>
                  <div className="h-[5px] rounded-full bg-brand-border overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${row.value}%`, background: 'var(--accent-gradient)' }}
                    />
                  </div>
                </div>
              ))}
              {marketValue && (
                <div className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] text-brand-muted">{t('collection.value')}</span>
                    <span className="ds-display text-[15px] font-extrabold text-white">{marketValue}</span>
                  </div>
                  <p className="text-[9.5px] text-brand-muted mt-1 leading-snug">
                    {valuedAt
                      ? t('collection.value_source_at', { source: 'Transfermarkt', date: valuedAt })
                      : t('collection.value_source', { source: 'Transfermarkt' })}
                  </p>
                </div>
              )}
            </div>
          </Section>
        )}

        {trophies.length > 0 && (
          <Section title={t('collection.trophies')}>
            <div className="space-y-2">
              {trophies.map((tr) => (
                <div
                  key={tr}
                  className="ds-panel flex items-center gap-2.5 bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5"
                >
                  <IconTrophy size={15} stroke={1.75} style={{ color: TIER_COLOR.legendary }} />
                  <span className="text-[12.5px] text-white/90">{tr}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {tournaments.length > 0 && (
          <Section title={t('collection.tournaments')}>
            <div className="space-y-2">
              {tournaments.map((tr) => (
                <div
                  key={tr}
                  className="ds-panel flex items-center gap-2.5 bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5"
                >
                  <IconFlag size={15} stroke={1.75} className="text-brand-muted" />
                  <span className="text-[12.5px] text-white/90">{tr}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Клуб — ЖИВАЯ ССЫЛКА, и стоит она перед карьерой намеренно: карьера
            это история, а это то, где он сейчас. Раньше клуб на досье был
            просто текстом, и путь «игрок → его команда → остальной состав»
            обрывался на первом шаге. */}
        {/* УРОВЕНЬ. Ставится перед клубом и карьерой, потому что это ответ на
            первый вопрос про футболиста — «насколько он хорош». Подпись
            обязательна: при basis = 'fame' число построено на просмотрах
            википедии и про игру не говорит НИЧЕГО, и показать его без
            оговорки значило бы выдать известность за мастерство. */}
        {level && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5
                          flex items-center gap-3">
            <span className="ds-display text-brand-accent text-2xl font-black tabular-nums leading-none">
              {level.level}
            </span>
            <span className="min-w-0">
              <span className="block text-brand-muted text-[10px] uppercase tracking-wide">
                {t('collection.level')}
              </span>
              <span className="block text-[11.5px] text-white/80">
                {t(`collection.level_basis_${level.basis.replace('+', '_')}`)}
              </span>
            </span>
          </div>
        )}

        {club && (
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate(`/club/${encodeURIComponent(club.club_key)}`); }}
            className="w-full ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5
                       flex items-center gap-3 text-left active:opacity-70 transition-opacity"
          >
            {club.crest_url ? (
              <img src={club.crest_url} alt="" className="w-8 h-8 rounded-lg object-contain bg-brand-bg shrink-0" loading="lazy" />
            ) : (
              <IconShirt size={16} stroke={1.75} className="text-brand-muted shrink-0" />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-brand-muted text-[10px] uppercase tracking-wide">
                {t('collection.f_club')}
              </span>
              <span className="block truncate text-[12.5px] text-white">{club.name}</span>
            </span>
            <span aria-hidden="true" className="text-brand-muted text-lg leading-none">›</span>
          </button>
        )}

        {/* КАРЬЕРА В ЦИФРАХ — первым из статистических блоков. Владелец:
            «отображай статистику игрока очень очень красиво, сейчас это просто
            даты, ничего не понятно». Блок «Собранная статистика» ниже начинал
            строку с ДВУХ ДАТ — периода сбора нашим конвейером, — и числа
            стояли третьими без подписей. Здесь сперва четыре числа карьеры,
            подписанные, и только потом клубы. */}
        <Section title={t('career.title')}>
          <CareerStats cardId={card.id} />
        </Section>

        {career.length > 0 && (
          <Section title={t('collection.career')}>
            <div>
              {career.map((row, i) => {
                const found = careerClubs.get(row.club);
                // ⚠️ ССЫЛКА ТОЛЬКО ТУДА, ГДЕ ЕСТЬ ЧТО ПОКАЗАТЬ. Клуб, которого
                // нет в справочнике, остаётся обычной строкой: ссылка в пустую
                // карточку хуже её отсутствия — читатель нажимает и получает
                // пустоту, а понять, что клуба у нас просто нет, ему нечем.
                const body = (
                  <>
                    {found?.crest_url ? (
                      <img
                        src={found.crest_url}
                        alt=""
                        loading="lazy"
                        className="w-4 h-4 mt-0.5 shrink-0 object-contain"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <IconShirt size={14} stroke={1.75} className="text-brand-muted mt-0.5 shrink-0" />
                    )}
                    <span className="flex-1 text-[12.5px] text-white/90">{row.club}</span>
                    <span className="text-[11.5px] text-brand-muted">{row.meta}</span>
                  </>
                );
                const cls = 'w-full flex gap-3 py-2.5 border-b border-brand-border last:border-b-0 text-left';
                return found?.card_id ? (
                  <button
                    key={`${row.club}-${i}`}
                    type="button"
                    onClick={() => {
                      hapticImpact('light');
                      navigate(`/collection?card=${found.card_id}`);
                    }}
                    className={`${cls} hover:text-brand-accent transition-colors`}
                  >
                    {body}
                    <span aria-hidden="true" className="text-brand-muted leading-none">›</span>
                  </button>
                ) : (
                  <div key={`${row.club}-${i}`} className={cls}>{body}</div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Собранная статистика — то же, что кормит рейтинг футболистов.
            Ставится ПОСЛЕ карьеры намеренно: карьера это история, а здесь
            только то, что конвейер видел своими глазами, и период подписан
            датами, чтобы блок не выдавал себя за полную карьеру. */}
        {collected.length > 0 && (
          <Section title={t('collection.collected')}>
            <div>
              {collected.map((row) => (
                <StatLine
                  key={row.tournament}
                  label={row.tournament}
                  sub={t('collection.collected_period', {
                    from: row.first_match,
                    to: row.last_match,
                  })}
                  value={t('collection.collected_line', {
                    matches: row.matches,
                    goals: row.goals,
                    assists: row.assists,
                  })}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Динамика показателей — «создай систему, которая бы отслеживала
            динамику по всем важным показателям в карточке игрока».
            Ставится ПОСЛЕ статистики: это производная от неё, а не факт сам
            по себе, и первым в досье она стоять не должна. */}
        {moved.length > 0 && (
          <Section title={t('collection.dynamics')}>
            <div>
              {moved.map((row) => (
                <StatLine
                  key={row.metric}
                  label={t(`collection.dyn.${row.metric}`, { defaultValue: row.metric })}
                  sub={t('collection.dyn_window')}
                  value={t('collection.dyn_line', {
                    was: formatMetric(row.metric, row.was, lang),
                    now: formatMetric(row.metric, row.now_value, lang),
                  })}
                  accent={(row.delta ?? 0) > 0}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Новости и видео — по фамилии из тех же лент, что кормят дайджест.
            Ставится ПОСЛЕ карьеры и собранной статистики: это самое свежее и
            самое необязательное — редкий инфоповод не должен быть первым,
            что видит человек, открывший досье легенды. */}
        {(news.length > 0 || clips.length > 0) && (
          <Section title={t('collection.news_and_video')}>
            <div className="space-y-3">
              {clips.length > 0 && (
                <div className="-mx-4 px-4 overflow-x-auto">
                  <div className="flex gap-2 w-max pb-0.5">
                    {clips.map((clip) => (
                      <button
                        key={clip.video_id}
                        type="button"
                        onClick={() => {
                          hapticImpact('light');
                          openLink(`https://www.youtube.com/watch?v=${clip.video_id}`);
                        }}
                        className="w-32 shrink-0 text-left"
                      >
                        {clip.thumb_url && (
                          <img
                            src={clip.thumb_url}
                            alt=""
                            loading="lazy"
                            className="w-32 aspect-video object-cover rounded-lg border border-brand-border"
                          />
                        )}
                        <p className="text-white text-[11px] mt-1 line-clamp-2 leading-tight">
                          {clip.title}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {news.length > 0 && (
                <div className="space-y-2">
                  {news.map((item) => (
                    <button
                      key={item.url}
                      type="button"
                      onClick={() => { hapticImpact('light'); openLink(item.url); }}
                      className="w-full flex items-start gap-2 text-left"
                    >
                      <span className="flex-1 min-w-0 text-[12.5px] text-white/90 leading-snug">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-brand-muted mt-0.5">
                        {item.source}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Section>
        )}

        {blurb && (
          <Section title={t('collection.about')}>
            <p
              className="text-[12.5px] leading-relaxed text-brand-muted bg-brand-surface
                         border border-brand-border rounded-xl px-3.5 py-3 ds-panel"
              style={{ borderLeftColor: catColor }}
            >
              {blurb}
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}
