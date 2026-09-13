import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { fetchMatchCharacter, type MatchCharacter as Row } from './matchCharacterApi';
import {
  characterBands, characterMatches, parseForm, sideHasFacts,
  type FormResult, type SideFacts,
} from './matchCharacter';

interface Props {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Характер матча по кнопке — переделан по разбору владельца.
 *
 * Он сказал три вещи, и каждая здесь исправлена отдельно:
 *
 *   «Описание нужно не такое общее, либо просто добавить сухую статистику»
 *   «в „пишут“ везде новости об анонсе матча и где его посмотреть»
 *   «строчка про травмы неинформативная, если нет данных её лучше не писать»
 *
 * ⚠️ 1. ОБЩИХ ФРАЗ БОЛЬШЕ НЕТ. Блок открывался двумя предложениями вида
 * «Голов ожидаем столько же, сколько в обычном матче» — это пересказ середины
 * шкалы, и владелец назвал его издевательским справедливо: читатель уже
 * знает, что бывают обычные матчи. Вместо них два ЧИСЛА рядом: ожидаемая
 * результативность и обычная (медиана по всем измеренным клубам). Оба
 * проверяемы; прилагательное — нет.
 *
 * ⚠️ 2. НОВОСТЬ ОТОБРАНА, А НЕ ВЗЯТА ПОСЛЕДНЕЙ. Отбор делает `news_about_play`
 * в SQL: анонсы и трансляции отбрасываются совсем, слова тренера поднимаются
 * наверх. Не нашлось ничего про игру — строки нет вовсе.
 *
 * ⚠️ 3. НЕТ ДАННЫХ — НЕТ СТРОКИ, и это правило принято ШИРЕ той строки, о
 * которой шла речь. Ушла строка про травмы (источника у проекта нет ни
 * одного); сторона без единого факта не рисуется; проценты атаки и обороны
 * появляются только вместе.
 *
 * ⚠️ ЭТО ПО-ПРЕЖНЕМУ НЕ ПРОГНОЗ СЧЁТА И НЕ ФАВОРИТ. Шапка FixtureCard
 * запрещает выделенную сторону и всё, производное от коэффициентов. Обе
 * стороны нарисованы одинаково, порядок всегда «хозяева, потом гости»,
 * ожидаемые голы названы СУММОЙ ДВУХ СТОРОН, а не счётом.
 *
 * ⚠️ СЧИТАЕТ БАЗА, А НЕ МОДЕЛЬ. Абзац прозы от модели неотличим от
 * выдуманного; число отличимо — под ним стоит, на скольких матчах оно
 * построено. Владелец к тому же прямо просил не тратить токены автоматически.
 */

/** Буква формы цветом: победа зелёным, поражение красным, ничья серым. */
function FormLetters({ letters }: { letters: string }) {
  const { t } = useTranslation();
  const tone: Record<FormResult, string> = {
    W: 'bg-emerald-500/20 text-emerald-400',
    D: 'bg-brand-bg text-brand-muted',
    L: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className="flex gap-0.5 shrink-0">
      {parseForm(letters).map((r, i) => (
        <span
          key={`${r}-${i}`}
          className={`w-3.5 h-3.5 rounded-sm text-[8.5px] leading-[14px] text-center font-bold ${tone[r]}`}
        >
          {t(`character.form_${r.toLowerCase()}`)}
        </span>
      ))}
    </span>
  );
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

  const facts = (which: 'home' | 'away'): SideFacts => ({
    traits: which === 'home' ? row!.home_traits : row!.away_traits,
    manager: which === 'home' ? row!.home_manager : row!.away_manager,
    headline: which === 'home' ? row!.home_headline : row!.away_headline,
    gf: which === 'home' ? row!.home_gf_pm : row!.away_gf_pm,
    ga: which === 'home' ? row!.home_ga_pm : row!.away_ga_pm,
    attack: which === 'home' ? row!.home_attack : row!.away_attack,
    defence: which === 'home' ? row!.home_defence : row!.away_defence,
    form: which === 'home' ? row!.home_form : row!.away_form,
  });

  // ⚠️ «НЕИЗВЕСТНО» ПИШЕТСЯ, ТОЛЬКО КОГДА НЕИЗВЕСТНО ВООБЩЕ НИЧЕГО. Раньше
  // оно печаталось при любом отсутствии характера — и заслоняло собой
  // тренера, форму и новость, которые в том же ответе лежали.
  const nothing = !row
    || (!bands && !sideHasFacts(facts('home')) && !sideHasFacts(facts('away')));

  const side = (team: string, s: SideFacts) => {
    if (!sideHasFacts(s)) return null;
    return (
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-brand-muted text-[9.5px] uppercase tracking-wider flex-1 min-w-0 truncate">
            {team}
          </p>
          {/* Форма — самое сухое, что у нас есть про команду, и порядок в ней
              значим: «три победы, потом два поражения» и обратное дают
              одинаковые 3-0-2 и описывают разные команды. */}
          {parseForm(s.form).length > 0 && <FormLetters letters={s.form!} />}
        </div>

        {s.traits.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.traits.map((code) => (
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
            то самое, чего этот блок не делает и делать не может. */}
        {(s.gf !== null && s.ga !== null) && (
          <p className="text-brand-muted text-[10px] mt-1">
            {t('character.match_side_numbers', { gf: s.gf, ga: s.ga })}
          </p>
        )}

        {/* Перцентили — вторая сухая строка: «выше 82% клубов» проверяемо, в
            отличие от слова «атакующая». Только вместе: одна половина без
            второй говорит о команде меньше, чем кажется. */}
        {(s.attack !== null && s.defence !== null) && (
          <p className="text-brand-muted text-[10px] mt-0.5">
            {t('character.match_side_ranks', { attack: s.attack, defence: s.defence })}
          </p>
        )}

        {s.manager && (
          <p className="text-brand-muted text-[10px] mt-0.5">
            {t('character.match_coach')}: <span className="text-white">{s.manager}</span>
          </p>
        )}

        {/* Заголовок новости — внешний текст. Печатается как текст, разметку
            React не исполняет. Ссылки здесь намеренно нет: читать новость есть
            где, а строка тут отвечает на «что говорят про игру». */}
        {s.headline && (
          <p className="text-brand-muted text-[10px] mt-0.5 line-clamp-2">
            {t('character.match_writing')}: {s.headline}
          </p>
        )}
      </div>
    );
  };

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

          {row && bands && (
            <div className="space-y-1">
              {/* Два числа рядом вместо прилагательного. Медианы может не быть
                  (пустой club_character) — тогда остаётся одно число, названное
                  тем, что оно есть. */}
              <p className="text-white text-[11.5px] leading-snug">
                {row.goals_median !== null
                  ? t('character.match_expected_vs', {
                      goals: row.expected_goals, median: row.goals_median,
                    })
                  : t('character.match_expected_total', { goals: row.expected_goals })}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent text-[10.5px]">
                  {t(`character.match_goals_${bands.goals}`)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent text-[10.5px]">
                  {t(`character.match_flow_${bands.flow}`)}
                </span>
              </div>
            </div>
          )}

          {/* ⚠️ СТОРОНЫ РИСУЮТСЯ И БЕЗ ХАРАКТЕРА, И ЭТО ПОЧИНКА, А НЕ
              ПОСЛАБЛЕНИЕ. Прежде весь блок висел на `bands`, то есть на
              измеренном характере ОБЕИХ сторон, — и вместе с характером
              пропадало то, что мы знаем и так: тренер, форма, новость. */}
          {row && (
            <>
              {side(row.home_name ?? homeTeam, facts('home'))}
              {side(row.away_name ?? awayTeam, facts('away'))}
            </>
          )}

          {/* ⚠️ СТРОКИ ПРО ТРАВМЫ ЗДЕСЬ БОЛЬШЕ НЕТ. Она печаталась всегда и
              сообщала, что данных о травмах у нас нет, — то есть занимала
              место, говоря об отсутствии. Источника травм у проекта
              по-прежнему ни одного; появится источник — появится строка. */}
          {row && bands && basis !== null && (
            <p className="text-brand-muted/70 text-[9.5px] mt-1.5">
              {t('character.match_basis', { count: basis })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
