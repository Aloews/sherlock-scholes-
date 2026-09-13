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
/** Есть ли у стороны хоть что-то, кроме имени: черты, числа, тренер, новость. */
function hasSide(row: Row, which: 'home' | 'away'): boolean {
  const traits = which === 'home' ? row.home_traits : row.away_traits;
  const manager = which === 'home' ? row.home_manager : row.away_manager;
  const headline = which === 'home' ? row.home_headline : row.away_headline;
  const gf = which === 'home' ? row.home_gf_pm : row.away_gf_pm;
  return (traits?.length ?? 0) > 0 || manager !== null || headline !== null || gf !== null;
}

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
  // ⚠️ «НЕИЗВЕСТНО» ПИШЕТСЯ, ТОЛЬКО КОГДА НЕИЗВЕСТНО ВООБЩЕ НИЧЕГО. Раньше
  // оно печаталось при любом отсутствии характера — и заслоняло собой
  // тренера и новость, которые в том же ответе лежали.
  const nothing = !row || (!bands && !hasSide(row, 'home') && !hasSide(row, 'away'));

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
      {/* ⚠️ ПОДПИСАНО СЛОВАМИ, А НЕ ДВОЕТОЧИЕМ. Здесь стояло «1.8 : 1.2 · за
          матч», и два числа через двоеточие читаются как ПРЕДСКАЗАННЫЙ СЧЁТ —
          то самое, чего этот блок не делает и делать не может. Это средние
          забитые и пропущенные за матч, и так это теперь и написано. */}
      {(gf !== null && ga !== null) && (
        <p className="text-brand-muted text-[10px] mt-1">
          {t('character.match_side_numbers', { gf, ga })}
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
          {nothing && (
            <p className="text-brand-muted text-[10px]">{t('character.match_unknown')}</p>
          )}

          {/* Две полосы характера — только когда ОБЕ стороны измерены: из них
              считаются и ожидаемые голы, и открытость, и одна измеренная
              сторона тут не помогает. */}
          {/* ⚠️ СНАЧАЛА ФРАЗОЙ, ПОТОМ ЧИСЛОМ. Владелец: «прогноз матча попробуй
              сделать более понятным». Прежде блок начинался с двух ярлыков и
              числа «Ждём голов: 2.7» — и число это НИЧЕГО не говорило само по
              себе: 2.7 чего, у кого, за какой срок. Две короткие фразы
              отвечают на вопрос, ради которого блок открывают: каким будет
              матч. Ярлыки остались ниже — они короткие и годятся, чтобы
              сравнить два матча глазами.

              Две отдельные фразы, а не одна составная: девять сочетаний
              «голы × течение» пришлось бы переводить девять раз на девяти
              языках, и в половине из них склейка вышла бы корявой. */}
          {row && bands && (
            <div className="space-y-1">
              <p className="text-white text-[11.5px] leading-snug">
                {t(`character.match_says_goals_${bands.goals}`)}{' '}
                {t(`character.match_says_flow_${bands.flow}`)}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent text-[10.5px]">
                  {t(`character.match_goals_${bands.goals}`)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent text-[10.5px]">
                  {t(`character.match_flow_${bands.flow}`)}
                </span>
              </div>
              {/* Число названо тем, что оно есть: сумма голов ОБЕИХ команд за
                  матч, а не счёт и не чья-то доля. */}
              <p className="text-brand-muted text-[10px]">
                {t('character.match_expected_total', { goals: row.expected_goals })}
              </p>
            </div>
          )}

          {/* ⚠️ СТОРОНЫ РИСУЮТСЯ И БЕЗ ХАРАКТЕРА, И ЭТО ПОЧИНКА, А НЕ
              ПОСЛАБЛЕНИЕ. Владелец: «доделай прогноз по кнопке». Прежде весь
              блок висел на `bands`, то есть на измеренном характере ОБЕИХ
              сторон, — и вместе с характером пропадало то, что мы знаем и так:
              тренер и свежая новость клуба. Замер 12.09.2026: из 600 сторон
              ближайших матчей характер есть у 341, а у 117 из оставшихся 259
              известен тренер. Показывать им «неизвестно», имея имя тренера, —
              это прятать от читателя то, что лежит в ответе. */}
          {row && (
            <>
              {side(row.home_name ?? homeTeam, row.home_traits, row.home_manager,
                    row.home_gf_pm, row.home_ga_pm, row.home_headline)}
              {side(row.away_name ?? awayTeam, row.away_traits, row.away_manager,
                    row.away_gf_pm, row.away_ga_pm, row.away_headline)}
            </>
          )}

          {row && bands && (
            <>
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
