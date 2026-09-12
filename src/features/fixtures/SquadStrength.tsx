import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { SquadList } from '@/features/clubs/SquadList';
import {
  fetchFixtureSquads, type SquadMember,
} from './squadStrengthApi';

interface Props {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Составы двух команд матча — по нажатию.
 *
 * ⚠️ ЭТО НЕ ПРОГНОЗ И НЕ «ФАВОРИТ». Шапка FixtureCard запрещает выделенную
 * сторону и всё, производное от коэффициентов. Здесь запрет соблюдён по сути,
 * а не по букве: обе стороны нарисованы ОДИНАКОВО, порядок всегда «хозяева,
 * потом гости» и никогда не переставляется по величине, значка фаворита нет.
 * Читатель сравнивает сам.
 *
 * ⚠️ РЕЙТИНГ БОЛЬШЕ НЕ РИСУЕТСЯ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА. «Пиши стоимость
 * игрока, а не наш рейтинг, у нашего рейтинга все футболисты имеют по 100.
 * Стоимость точнее отражает уровень игрока». Стоимость каждой стороны уже
 * стоит в строке матча (FixtureCard, данные из fixture_clubs), а стоимость
 * каждого игрока — в раскрытом составе. Сам рейтинг не удалён ни из базы, ни
 * из ответа RPC: владелец хочет позже сравнить, какой показатель вернее.
 *
 * ⚠️ СОСТАВ РАСКРЫВАЕТСЯ ПО ТРЕБОВАНИЮ, И ЭТО НЕ ЛЕНЬ. Матчей в списке до
 * трёхсот, и тянуть составы всех сразу — это вес первого захода, та самая
 * цифра, что стоит первой строкой в check-limits.
 *
 * ⚠️ ПОМЕТКИ «ВОШЁЛ В РАСЧЁТ» БОЛЬШЕ НЕТ, И ЭТО НЕ ПОТЕРЯ. Она отвечала на
 * вопрос «из кого посчитано число», а числа на экране нет: приглушённые
 * строки без него означали бы неизвестно что.
 */
export function SquadStrength({ fixtureId, homeTeam, awayTeam }: Props) {
  const { t, i18n } = useTranslation();
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
    // Разметку списка держит SquadList — она же на экране команд. Владелец:
    // «экран „команды и статистика“ синхронизируй с функцией „показать
    // составы“»; две копии одного списка разошлись бы так же, как разошлись
    // две функции базы до этого.
    return <SquadList rows={rows} title={team} />;
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
