import { useTranslation } from 'react-i18next';
import { IconDeviceTvOld } from '@tabler/icons-react';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import { leagueKey, readableSportKey } from './leagues';
import { PredictionRow } from './PredictionRow';
import type { Fixture } from './fixturesApi';
import type { Broadcast } from './broadcastsApi';
import type { Prediction } from './predictionsApi';

interface Props {
  fixture: Fixture;
  broadcast?: Broadcast;
  prediction?: Prediction;
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
 */
export function FixtureCard({
  fixture, broadcast, prediction, onPredictionSaved, timeFmt,
}: Props) {
  const { t } = useTranslation();
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const age = fixture.completed ? null : ageMinutes(fixture.scores_at);

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3">
      <div className="flex items-center gap-3">
        <span className="ds-display text-white text-sm font-bold tabular-nums shrink-0 w-12">
          {timeFmt.format(new Date(fixture.commence_at))}
        </span>

        <div className="flex-1 min-w-0">
          {/* Написание провайдера, по-английски. Переводить названия клубов
              здесь было бы нечем: для большинства из них у нас нет
              соответствия, а наполовину переведённый список читается хуже
              последовательного. */}
          <p className="text-white text-sm truncate">{fixture.home_team}</p>
          <p className="text-white text-sm truncate">{fixture.away_team}</p>
        </div>

        {hasScore && (
          <div className="shrink-0 text-right">
            <p className="ds-display text-white text-sm font-bold tabular-nums leading-tight">
              {fixture.home_score}
            </p>
            <p className="ds-display text-white text-sm font-bold tabular-nums leading-tight">
              {fixture.away_score}
            </p>
          </div>
        )}

        <span className="text-brand-muted text-[10.5px] text-right shrink-0 max-w-[35%]">
          {t(leagueKey(fixture.sport_key), {
            defaultValue: readableSportKey(fixture.sport_key),
          })}
        </span>
      </div>

      {hasScore && (
        <p className="mt-1 ml-[3.75rem] text-brand-muted/70 text-[10px]">
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
      {broadcast && (
        <button
          type="button"
          onClick={() => { hapticImpact('light'); openLink(broadcast.url); }}
          className="mt-2 ml-[3.75rem] inline-flex items-center gap-1.5 text-brand-muted hover:text-brand-accent transition-colors text-[10.5px]"
        >
          <IconDeviceTvOld size={13} stroke={1.75} />
          <span>{t('matches.where_to_watch', { source: broadcast.name })}</span>
        </button>
      )}

      <div className="mt-2 pl-[3.75rem]">
        <PredictionRow
          fixture={fixture}
          existing={prediction}
          onSaved={onPredictionSaved}
        />
      </div>
    </div>
  );
}
