import { useTranslation } from 'react-i18next';
import { IconDeviceTvOld } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { formatEur } from '@/shared/lib/money';
import { fixtureCountdown } from '@/shared/lib/fixtureCountdown';
import { leagueKey, readableSportKey } from './leagues';
import { Crest } from './Crest';
import type { FixtureClubs } from './fixtureClubsApi';
import { PredictionRow } from './PredictionRow';
import type { Fixture } from './fixturesApi';
import type { Broadcast } from './broadcastsApi';
import type { BroadcastRight } from './broadcastRightsApi';
import type { Prediction } from './predictionsApi';
import { SquadStrength } from './SquadStrength';
import { MatchCharacter } from './MatchCharacter';
import type { TeamRating } from './squadStrengthApi';

interface Props {
  fixture: Fixture;
  broadcast?: Broadcast;
  /**
   * Правообладатель для страны читателя. Отсутствие значит одно из двух —
   * страна не объявлена или вещатель для неё не назван, — и различать их
   * карточке незачем: обе ситуации показываются одинаково, ссылкой на
   * страницу турнира.
   */
  rights?: BroadcastRight;
  prediction?: Prediction;
  /**
   * Уровень состава обеих команд по известности их игроков. Есть далеко не у
   * каждого матча — оцифрованы не все клубы, — и отсутствие показывается
   * НИКАК: «состав 0» читалось бы как «слабый», хотя значит «мы не знаем».
   */
  rating?: TeamRating;
  /**
   * Наши клубы за именами команд из расписания: эмблема, название на языке
   * читателя, стоимость и состав каждой стороны. Отсутствует, пока запрос не
   * пришёл, и остаётся отсутствовать у матча, чью команду сопоставить не
   * удалось: тогда карточка показывает то же, что показывала раньше —
   * английское написание провайдера и время.
   */
  clubs?: FixtureClubs;
  onPredictionSaved: (saved: Prediction) => void;
  timeFmt: Intl.DateTimeFormat;
}

/** Насколько устарел счёт, в минутах. */
function ageMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 60_000));
}

/**
 * Один матч.
 *
 * Вынесен из экрана, потому что его рисуют оба режима — и список ближайших, и
 * календарь по дням. Пока он был встроен, второй режим означал бы вторую
 * копию разметки, и они разошлись бы на первой же правке.
 *
 * ⚠️ СЧЁТ ПОКАЗЫВАЕТСЯ ВМЕСТЕ С ЕГО ВОЗРАСТОМ, И ЭТО ТРЕБОВАНИЕ СХЕМЫ, а не
 * украшение: `fixtures.scores_at` заведён с прямым комментарием, что экран
 * обязан показывать возраст, а не счёт как таковой. Счёт пятнадцатиминутной
 * давности, поданный как текущий, — то самое враньё, из-за которого из
 * источников счетов когда-то выбросили википедию. У завершённого матча
 * возраст не нужен: он уже не изменится.
 *
 * НИКАКИХ КОЭФФИЦИЕНТОВ И НИЧЕГО ПРОИЗВОДНОГО. Ни «фаворита», ни выделенной
 * стороны, ни порядка, который её кодирует. `fixture_odds` не имеет ни гранта,
 * ни политики, так что прочитать их отсюда нельзя даже по ошибке.
 *
 * ⚠️ УРОВЕНЬ СОСТАВА — ИСКЛЮЧЕНИЕ ПО ПРОИСХОЖДЕНИЮ, НО НЕ ПО ПРАВИЛУ ВЫШЕ, и
 * разницу стоит записать, потому что она неочевидна. Запрет касается
 * букмекерских котировок: их нельзя ни показать, ни вывести из них что-либо.
 * `SquadStrength` считается из СВОИХ ЖЕ карточек (уровни игроков клуба) и
 * к котировкам отношения не имеет.
 *
 * Само правило при этом соблюдается ПО СУТИ: обе стороны нарисованы
 * одинаково, порядок всегда «хозяева, потом гости» и никогда не
 * переставляется по величине, значка фаворита нет, вероятностей нет. Число
 * подписано тем, что оно есть, — известностью состава, а не силой и не
 * прогнозом. Появилось взамен истории противостояний, которую строить не из
 * чего: 0 из 266 предстоящих матчей имеют прошлую встречу.
 */
export function FixtureCard({
  fixture, broadcast, rights, prediction, rating, clubs, onPredictionSaved, timeFmt,
}: Props) {
  const { t, i18n } = useTranslation();
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const age = fixture.completed ? null : ageMinutes(fixture.scores_at);

  // Название на языке читателя, если клуб опознан; иначе — написание
  // провайдера, как было. Наполовину переведённый список читается хуже
  // последовательного, но «Реал Мадрид» там, где мы клуб знаем, лучше, чем
  // «Real Madrid» везде из-за тех, кого не знаем.
  const homeName = clubs?.home_name ?? fixture.home_team;
  const awayName = clubs?.away_name ?? fixture.away_team;

  // ⚠️ ОБРАТНЫЙ ОТСЧЁТ ТОЛЬКО У НЕСЫГРАННОГО. Минуты приходят из базы и у
  // прошедшего матча отрицательны, а `fixtureCountdown` читает отрицательное
  // как «уже идёт» — верно для списка ближайших и неверно для календаря,
  // который показывает и сыгранные дни.
  const cd = fixture.completed ? { kind: 'date' as const }
                               : fixtureCountdown(clubs?.minutes_to_start);
  const alert = cd.kind === 'alert' || cd.kind === 'live';
  const timing =
    cd.kind === 'live'    ? t('fixtures.live')
    : cd.kind === 'alert' ? t('fixtures.in_minutes', { count: cd.minutes })
    : cd.kind === 'hours' ? t('fixtures.in_hours', { count: cd.hours })
    : null;
  const comp = t(leagueKey(fixture.sport_key), {
    defaultValue: readableSportKey(fixture.sport_key),
  });
  // Стоимость и состав — У ДВУХ КЛУБОВ ПОРОЗНЬ, а не суммой, как на главной.
  // Владелец: «оставить составы и стоимость считать у двух клубов». Матч
  // читают, сравнивая стороны; одна сумма сравнивать не даёт.
  const side = (value: number | null | undefined, squad: number | undefined) => {
    // formatEur сам возвращает null на пустой и неположительной сумме —
    // клуб без единой цены не должен подписываться нулём евро.
    const money = formatEur(value, i18n.language);
    const parts = [money, squad ? t('club.squad_size', { count: squad }) : null];
    return parts.filter(Boolean).join(' · ');
  };
  const homeSide = side(clubs?.home_value, clubs?.home_squad);
  const awaySide = side(clubs?.away_value, clubs?.away_squad);

  return (
    <div className={`ds-panel bg-brand-surface border rounded-2xl p-3 ${
      // Матч, на который ещё можно успеть, отличается рамкой — ровно как на
      // главной: это единственная строка здесь, требующая действия сейчас.
      alert ? 'border-brand-accent' : 'border-brand-border'
    }`}>
      {/* ⚠️ ОДНА СТРОКА «ХОЗЯЕВА — ГОСТИ» С ЭМБЛЕМАМИ, КАК НА ГЛАВНОЙ.
          Владелец: «нужно экран ближайших матчей доделать до уровня, того
          отображения, что на главной». Прежние две строки без эмблем и без
          перевода отличались от главной ровно тем, что делает матч
          узнаваемым с одного взгляда. Порядок «хозяева, потом гости» не
          переставляется никогда — см. шапку файла. */}
      <div className="flex items-center gap-2">
        <Crest src={clubs?.home_crest ?? null} alt={homeName} />
        <span className="text-white text-[12.5px] flex-1 min-w-0 truncate">
          {homeName}
        </span>
        {/* Счёт держит место и без счёта: подтягивать имена там, где его нет,
            значит дёргать ширину на каждой второй строке списка, где
            сыгранные и несыгранные идут вперемешку. */}
        <span className="ds-display text-white text-[12.5px] font-bold tabular-nums shrink-0">
          {hasScore
            ? `${fixture.home_score} : ${fixture.away_score}`
            : <span className="text-brand-muted/40">—</span>}
        </span>
        <span className="text-white text-[12.5px] flex-1 min-w-0 truncate text-right">
          {awayName}
        </span>
        <Crest src={clubs?.away_crest ?? null} alt={awayName} />
      </div>

      {/* Стоимость и состав каждой стороны — под её же названием. */}
      {(homeSide || awaySide) && (
        <div className="flex items-start gap-2 mt-1">
          <span className="text-brand-accent text-[10px] tabular-nums flex-1 min-w-0 truncate">
            {homeSide}
          </span>
          <span className="text-brand-accent text-[10px] tabular-nums flex-1 min-w-0 truncate text-right">
            {awaySide}
          </span>
        </div>
      )}

      {/* Время, турнир и — пока он что-то значит — обратный отсчёт. */}
      <div className="mt-1.5">
        <span className={`text-[10.5px] ${
          alert ? 'text-brand-accent font-semibold' : 'text-brand-muted'
        }`}>
          {[timeFmt.format(new Date(fixture.commence_at)), comp, timing]
            .filter(Boolean).join(' · ')}
        </span>
      </div>

      {hasScore && (
        <p className="mt-1 text-brand-muted/70 text-[10px]">
          {fixture.completed
            ? t('matches.final_score')
            : age === null
              ? t('matches.score_age_unknown')
              : t('matches.score_age', { count: age })}
        </p>
      )}

      {/* «Где смотреть» — страница САМОГО турнира, а не канал. Права
          перепродаются каждый сезон, и строка «в вашей стране это такой-то
          канал» устаревает молча: человек уходит не туда, а экран выглядит
          уверенным. Официальная страница верна всегда, потому что её ведёт
          правообладатель. Турнира нет в таблице — ссылки нет: обещать
          нерабочий адрес хуже, чем не обещать ничего. */}
      {/* ПРАВООБЛАДАТЕЛЬ ВМЕСТО СТРАНИЦЫ ТУРНИРА — но только когда он назван
          самим турниром И назван со сроком. Тогда ссылка ведёт туда же, а
          подпись отвечает точнее: не «где узнать», а «кто показывает».
          Сезон рядом с именем не украшение: он и есть то, что отличает эту
          строку от таблицы, которую broadcasts.sql вести отказалась. */}
      {rights ? (
        <button
          type="button"
          onClick={() => { hapticImpact('light'); openLink(rights.source_url); }}
          className="mt-2 inline-flex items-center gap-1.5 text-brand-muted hover:text-brand-accent transition-colors text-[10.5px]"
        >
          <IconDeviceTvOld size={13} stroke={1.75} />
          <span>{t('matches.broadcaster', { name: rights.broadcaster })}</span>
          {rights.season_from && (
            <span className="opacity-60">{rights.season_from}</span>
          )}
        </button>
      ) : broadcast && (
        <button
          type="button"
          onClick={() => { hapticImpact('light'); openLink(broadcast.url); }}
          className="mt-2 inline-flex items-center gap-1.5 text-brand-muted hover:text-brand-accent transition-colors text-[10.5px]"
        >
          <IconDeviceTvOld size={13} stroke={1.75} />
          <span>{t('matches.where_to_watch', { source: broadcast.name })}</span>
        </button>
      )}

      {rating && (
        <div>
          <SquadStrength
            fixtureId={fixture.id}
            homeTeam={fixture.home_team}
            awayTeam={fixture.away_team}
          />
        </div>
      )}

      {/* ⚠️ БЕЗ УСЛОВИЯ, В ОТЛИЧИЕ ОТ СОСТАВОВ ВЫШЕ. Характер есть у 366
          клубов, и у доброй половины ближайших матчей одна сторона без него —
          то есть спрятать кнопку «где не измерено» значило бы спрятать её у
          половины матчей и оставить читателя гадать, почему у соседнего матча
          она есть. Нажатие в этом случае отвечает словами. */}
      <MatchCharacter
        fixtureId={fixture.id}
        homeTeam={fixture.home_team}
        awayTeam={fixture.away_team}
      />

      <div className="mt-2">
        <PredictionRow
          fixture={fixture}
          existing={prediction}
          onSaved={onPredictionSaved}
        />
      </div>
    </div>
  );
}
