import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { TIER_COLOR } from '@/shared/types/database';
import { SW_LINES, swLine, swRatingTier, type SwLine } from '@/shared/lib/soccerwikiPosition';
import { hapticImpact } from '@/shared/lib/telegram';
import { fetchSoccerWikiSquad, type SoccerWikiSquadRow } from './soccerwikiApi';

/**
 * Вид карточки команды: состав с рейтингами Soccer Wiki, по линиям.
 *
 * Владелец: «вид карточки команд и игроков и данные взять с
 * https://en.soccerwiki.org/».
 *
 * ⚠️ ЭТО ТРЕТИЙ СОСТАВ НА ЭКРАНЕ КОМАНДЫ, И У КАЖДОГО СВОЙ ВОПРОС.
 * `club_squad_list` отвечает «кто и сколько сыграл за 365 дней» — наша
 * статистика. `club_roster_list` отвечает «кто заявлен и сколько стоит» —
 * Transfermarkt. Этот отвечает «кто сильнее» и раскладывает состав ПО ЛИНИЯМ,
 * чего не делает ни один из двух: позиции у нас до сих пор не было вовсе, был
 * только текст из инфобокса.
 *
 * ⚠️ ЛИНИЮ СЧИТАЕТ `swLine`, И ВТОРОЙ ЕЁ КОПИИ ЗДЕСЬ НЕТ. Неразобранный код
 * попадает в «прочие» отдельной группой, а не подмешивается к полузащите:
 * разметка источника поменяется — это будет видно списком, а не молча
 * разложится по линиям неправильно.
 *
 * ⚠️ СТРОКА КЛИКАБЕЛЬНА ТОЛЬКО У СВЯЗАННЫХ С КОЛОДОЙ. У источника 49 923
 * игрока, у нас 27 098 карточек: тап по несвязанному вёл бы в пустоту.
 */
export function SoccerWikiSquad({ clubKey }: { clubKey: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LoadState<SoccerWikiSquadRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setRows(LOADING);
    void fetchSoccerWikiSquad(clubKey).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [clubKey]);

  const list = rows.status === 'ok' ? rows.data : [];

  const groups = useMemo(() => {
    const by = new Map<SwLine | 'other', SoccerWikiSquadRow[]>();
    for (const r of list) {
      const key = swLine(r.position) ?? 'other';
      const bucket = by.get(key);
      if (bucket) bucket.push(r); else by.set(key, [r]);
    }
    return [...SW_LINES, 'other' as const]
      .map((line) => ({ line, players: by.get(line) ?? [] }))
      .filter((g) => g.players.length > 0);
  }, [list]);

  // Средний рейтинг — по тем, у кого он есть. Считать отсутствующий за ноль
  // значило бы наказывать команду за неполноту НАШЕГО сбора.
  const rated = list.filter((r) => r.rating != null);
  const avg = rated.length
    ? Math.round(rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length)
    : null;
  const ages = list.filter((r) => r.age != null);
  const avgAge = ages.length
    ? Math.round(ages.reduce((s, r) => s + (r.age ?? 0), 0) / ages.length)
    : null;

  // ⚠️ НЕТ СОСТАВА — НЕТ БЛОКА. Пустая рамка «состав Soccer Wiki» на клубе,
  // которого в источнике нет, читалась бы как «состав пуст».
  if (list.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        {avg != null && (
          <Badge value={String(avg)} label={t('sw.avg_rating')} tone={TIER_COLOR[swRatingTier(avg)]} />
        )}
        {avgAge != null && <Badge value={String(avgAge)} label={t('sw.avg_age')} />}
        <Badge value={String(list.length)} label={t('sw.squad_size')} />
      </div>

      {groups.map((g) => (
        <div key={g.line} className="space-y-1">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-brand-muted">
            {t(`sw.line_${g.line}`)}
          </p>
          <div className="space-y-1">
            {g.players.map((p) => {
              const tone = TIER_COLOR[swRatingTier(p.rating)];
              const clickable = p.card_id != null;
              return (
                <button
                  key={p.pid}
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (!clickable) return;
                    hapticImpact('light');
                    navigate(`/collection?card=${encodeURIComponent(p.card_id!)}`);
                  }}
                  className={`w-full ds-panel bg-brand-surface border border-brand-border rounded-xl
                              px-2.5 py-2 flex items-center gap-2.5 text-left
                              ${clickable ? 'active:opacity-70 transition-opacity' : 'cursor-default'}`}
                >
                  <span
                    className="w-8 shrink-0 ds-display text-[15px] font-black tabular-nums text-center"
                    style={{ color: p.rating != null ? tone : undefined }}
                  >
                    {p.rating ?? '—'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] text-white truncate">{p.name}</span>
                    <span className="block text-[10px] text-brand-muted truncate tabular-nums">
                      {[p.position, p.age != null ? t('sw.years', { count: p.age }) : null,
                        p.height_cm != null ? t('sw.cm', { value: p.height_cm }) : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {p.shirt_number != null && (
                    <span className="text-[11px] text-brand-muted tabular-nums shrink-0">
                      #{p.shirt_number}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-[9.5px] text-brand-muted">{t('sw.source')}</p>
    </div>
  );
}

function Badge({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex-1 rounded-xl bg-brand-bg/60 border border-brand-border px-2 py-2 text-center">
      <p
        className="ds-display text-[16px] font-bold tabular-nums leading-none"
        style={{ color: tone }}
      >
        {value}
      </p>
      <p className="text-brand-muted text-[9px] uppercase tracking-wide mt-1 truncate">{label}</p>
    </div>
  );
}
