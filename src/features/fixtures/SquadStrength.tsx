import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { IconChevronDown } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import {
  fetchFixtureSquads, type SquadMember,
} from './squadStrengthApi';

interface Props {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Рейтинг двух команд матча — двумя полосами.
 *
 * ⚠️ ЭТО НЕ ПРОГНОЗ И НЕ «ФАВОРИТ». Шапка FixtureCard запрещает выделенную
 * сторону и всё, производное от коэффициентов. Здесь другое происхождение —
 * уровни своих же карточек и результаты матчей, а не букмекер, — но правило
 * соблюдается по сути, а не по букве: обе стороны нарисованы ОДИНАКОВО,
 * порядок всегда «хозяева, потом гости» и никогда не переставляется по
 * величине, значка фаворита нет. Читатель сравнивает сам.
 *
 * ⚠️ ЧИСЛО ПОДПИСАНО ТЕМ, ЧТО ОНО ЕСТЬ. Рейтинг собран из УРОВНЕЙ ИГРОКОВ
 * (player_level — половина известности, половина отдачи за матч) и, где есть,
 * из формы команды по результатам. Рядом стоит глубина: оценка по пяти
 * игрокам и по одиннадцати — разные утверждения, и прятать разницу нечестно.
 *
 * ⚠️ СОСТАВ РАСКРЫВАЕТСЯ ПО ТРЕБОВАНИЮ, И ЭТО НЕ ЛЕНЬ. Число без состава
 * нечем проверить: «Зенит 68.8» выглядит одинаково и когда команда
 * действительно такая, и когда в составе три случайных человека. Но матчей в
 * списке до трёхсот, и тянуть составы всех сразу — это вес первого захода,
 * та самая цифра, что стоит первой строкой в check-limits.
 *
 * ⚠️ В СПИСКЕ ОТМЕЧЕНО, КТО ВОШЁЛ В РАСЧЁТ. Рейтинг берёт РАВНОЕ число лучших
 * с обеих сторон, иначе сравнивался бы весь состав одного со звёздами
 * другого. Показать все строки без пометки значило бы показать не тот состав,
 * по которому посчитано число, — и экран разошёлся бы с рейтингом, оба
 * выглядя верно.
 *
 * ⚠️ МЕЖДУ ЛИГАМИ НЕ СРАВНИВАЕТСЯ. Уровень игрока наполовину построен на
 * известности, а она сильно зависит от языка и внимания: у РПЛ выходит 30–40
 * там, где у АПЛ 68–86. Внутри матча это не мешает — обе команды почти всегда
 * из одной лиги, — но складывать эти числа в общую таблицу лиг нельзя.
 */
export function SquadStrength({ fixtureId, homeTeam, awayTeam }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [squads, setSquads] = useState<SquadMember[] | null>(null);
  // ⚠️ РЕЙТИНГ БОЛЬШЕ НЕ РИСУЕТСЯ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА. «В прогнозах и
  // анонсах писалась стоимость, как сейчас, а не рейтинг… сделаем основным
  // рейтингом всего для всех экранов именно стоимость». Стоимость каждой
  // стороны уже стоит в строке матча (FixtureCard, данные из fixture_clubs),
  // и два разных числа про одно и то же спорили бы друг с другом.
  //
  // ⚠️ САМ РЕЙТИНГ НЕ УДАЛЁН — ни из базы, ни из этого запроса: владелец
  // хочет позже сравнить, какой показатель вернее отражает силу. Здесь он
  // просто не показывается. Блок остался ради разворачиваемого состава: это
  // единственный вход в «кто вообще играет» из строки матча.

  const toggle = () => {
    hapticImpact('light');
    const next = !open;
    setOpen(next);
    if (next && squads === null) {
      fetchFixtureSquads(fixtureId, i18n.language).then(setSquads);
    }
  };

  const side = (which: 'home' | 'away', team: string) => {
    const rows = (squads ?? []).filter((m) => m.side === which);
    if (rows.length === 0) return null;
    return (
      <div className="mt-2">
        <p className="text-brand-muted text-[9.5px] uppercase tracking-wider mb-1">{team}</p>
        <div className="space-y-0.5">
          {rows.map((m) => (
            <button
              key={m.card_id}
              type="button"
              onClick={() => { hapticImpact('light'); navigate(`/collection?card=${m.card_id}`); }}
              className="w-full flex items-center gap-2 text-left active:opacity-70 transition-opacity"
            >
              {/* Не вошедшие в расчёт приглушены, а не спрятаны: спрятать
                  значило бы соврать про размер состава. */}
              <span className={`flex-1 truncate text-[10.5px] ${
                m.in_rating ? 'text-white' : 'text-brand-muted/60'}`}>
                {m.name}
              </span>
              <span className={`text-[10.5px] tabular-nums w-6 text-right shrink-0 ${
                m.in_rating ? 'text-brand-accent' : 'text-brand-muted/60'}`}>
                {m.level}
              </span>
            </button>
          ))}
        </div>
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
        {t('matches.show_squads')}
      </button>

      {open && squads === null && (
        <p className="text-brand-muted text-[10px]">{t('digest.loading')}</p>
      )}
      {open && squads !== null && (
        <>
          {side('home', homeTeam)}
          {side('away', awayTeam)}
        </>
      )}
    </div>
  );
}
