import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { fetchMatchCharacter, type MatchCharacter as Row } from './matchCharacterApi';
import { characterBands, characterMatches } from './matchCharacter';

interface Props {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Характер матча по кнопке.
 *
 * ⚠️ ЭТО НЕ ПРОГНОЗ СЧЁТА И НЕ ФАВОРИТ. Шапка FixtureCard запрещает выделенную
 * сторону, вероятности и всё, производное от коэффициентов, — и здесь запрет
 * соблюдён не по букве, а по сути: обе стороны нарисованы ОДИНАКОВО, порядок
 * всегда «хозяева, потом гости», ожидаемые голы названы СУММОЙ ДВУХ СТОРОН, а
 * не счётом, и ни одного числа, читаемого как шанс, здесь нет.
 *
 * Вопрос, на который отвечает блок, другой: КАКИМ будет матч — открытым или
 * вязким, результативным или скупым. Именно это и просил владелец: «как будет
 * разворачиваться характер игры».
 *
 * ⚠️ СЧИТАЕТ БАЗА, А НЕ МОДЕЛЬ, и это решение, а не экономия. Абзац прозы от
 * модели неотличим от выдуманного; число отличимо — под ним стоит, на скольких
 * матчах оно построено. Плюс владелец прямо просил не тратить токены
 * автоматически.
 *
 * ⚠️ ПО ТРЕБОВАНИЮ. Один вызов — 753 мс (замер 09.09.2026), из них 435 на
 * новости обоих клубов. Для нажатия нормально, для списка из трёхсот матчей —
 * нет; поэтому кнопка, а не автозагрузка.
 */
export function MatchCharacter({ fixtureId, homeTeam, awayTeam }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<Row | null | undefined>(undefined);

  const toggle = () => {
    hapticImpact('light');
    const next = !open;
    setOpen(next);
    if (next && row === undefined) {
      fetchMatchCharacter(fixtureId, i18n.language).then((r) => setRow(r));
    }
  };

  const bands = row ? characterBands(row.expected_goals, row.openness) : null;
  const basis = row ? characterMatches(row.home_matches, row.away_matches) : null;

  const side = (
    team: string,
    traits: string[],
    manager: string | null,
    gf: number | null,
    ga: number | null,
    headline: string | null,
  ) => (
    <div className="mt-2">
      <p className="text-brand-muted text-[9.5px] uppercase tracking-wider mb-1">{team}</p>
      {traits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {traits.map((code) => (
            <span
              key={code}
              className="px-1.5 py-0.5 rounded bg-brand-bg text-brand-accent text-[10px]"
            >
              {t(`character.${code}`, { defaultValue: code })}
            </span>
          ))}
        </div>
      )}
      {(gf !== null && ga !== null) && (
        <p className="text-brand-muted text-[10px] mt-1 tabular-nums">
          {gf} : {ga} · {t('character.match_per_match')}
        </p>
      )}
      {manager && (
        <p className="text-brand-muted text-[10px] mt-0.5">
          {t('character.match_coach')}: <span className="text-white">{manager}</span>
        </p>
      )}
      {/* Заголовок новости — внешний текст. Печатается как текст, разметку
          React не исполняет; ссылки здесь намеренно нет: читать новость есть
          где, а строка тут отвечает на «что вокруг матча». */}
      {headline && (
        <p className="text-brand-muted text-[10px] mt-0.5 line-clamp-2">
          {t('character.match_writing')}: {headline}
        </p>
      )}
    </div>
  );

  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1 text-brand-muted text-[10px] pt-0.5
                   active:opacity-70 transition-opacity"
      >
        <IconChevronDown
          size={12}
          stroke={2}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
        {t('character.match_title')}
      </button>

      {open && row === undefined && (
        <p className="text-brand-muted text-[10px]">{t('digest.loading')}</p>
      )}

      {open && row !== undefined && (
        <>
          {/* ⚠️ ПУСТО — ЭТО ОТВЕТ, А НЕ ОШИБКА, и он написан словами. Характер
              есть у 366 клубов; у доброй половины ближайших матчей одна из
              сторон сыграла меньше десяти матчей за окно. Показать таким
              «сбалансированный» значило бы выдать незнание за измерение. */}
          {(!row || !bands) && (
            <p className="text-brand-muted text-[10px]">{t('character.match_unknown')}</p>
          )}

          {row && bands && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent text-[10.5px]">
                  {t(`character.match_goals_${bands.goals}`)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent text-[10.5px]">
                  {t(`character.match_flow_${bands.flow}`)}
                </span>
                <span className="text-brand-muted text-[10px] tabular-nums">
                  {t('character.match_expected')}: {row.expected_goals}
                </span>
              </div>

              {side(row.home_name ?? homeTeam, row.home_traits, row.home_manager,
                    row.home_gf_pm, row.home_ga_pm, row.home_headline)}
              {side(row.away_name ?? awayTeam, row.away_traits, row.away_manager,
                    row.away_gf_pm, row.away_ga_pm, row.away_headline)}

              {basis !== null && (
                <p className="text-brand-muted/70 text-[9.5px] mt-1.5">
                  {t('character.match_basis', { count: basis })}
                </p>
              )}
              <p className="text-brand-muted/70 text-[9.5px]">
                {t('character.match_no_injuries')}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
