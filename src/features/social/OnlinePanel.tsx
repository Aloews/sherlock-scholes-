import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconUserPlus, IconLoader2, IconEyeOff, IconEye } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { useGameStore } from '@/shared/store/gameStore';
import { getRawInitData, hapticImpact, hapticSuccess, hapticError } from '@/shared/lib/telegram';
import { inviteToRoom } from '@/features/lobby/inviteApi';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { fetchOnlinePlayers, touchPresence, type OnlinePlayer } from './presenceApi';

/** Как часто перечитывать список. Реже удара сердца — список и так живой. */
const REFRESH_MS = 60_000;

function nameOf(p: OnlinePlayer): string {
  const parts = [p.first_name, p.last_name].filter(Boolean);
  return parts.length ? parts.join(' ') : `#${p.player_id}`;
}

/**
 * Кто сейчас в приложении — и позвать их.
 *
 * ⚠️ ПУСТОЙ СПИСОК ЭТО ОТВЕТ, А НЕ ПОЛОМКА. В небольшом приложении ночью
 * онлайн честно никого, и написать «сейчас никого» правильнее, чем показать
 * «не загрузилось». Различать эти два состояния — ровно то, ради чего в
 * проекте заведён LoadState.
 *
 * ⚠️ ПОЗВАТЬ МОЖНО ТОЛЬКО ИЗ КОМНАТЫ, и кнопка это показывает. `invite_to_room`
 * требует room_id: приглашение — это «приходи В КОМНАТУ», а не абстрактный
 * сигнал. Без комнаты кнопка неактивна с подписью, а не молча ничего не
 * делает: молчащая кнопка читается как поломка.
 */
export function OnlinePanel() {
  const { t } = useTranslation();
  const room = useGameStore((s) => s.room);
  const [list, setList] = useState<LoadState<OnlinePlayer[]>>(LOADING);
  const [busy, setBusy] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    void fetchOnlinePlayers(getRawInitData()).then(setList);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    hapticImpact('light');
    // Видимость меняется ТОЛЬКО здесь: удар сердца шлёт null и выбор не трогает.
    void touchPresence(getRawInitData(), next).then(load);
  };

  const invite = (playerId: number) => {
    if (!room) return;
    setBusy(playerId);
    hapticImpact('light');
    void inviteToRoom(getRawInitData(), room.id, playerId)
      .then((ok) => { ok ? hapticSuccess() : hapticError(); })
      .finally(() => setBusy(null));
  };

  const people = list.status === 'ok' ? list.data : [];

  return (
    <section className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-brand-muted text-[10.5px] uppercase tracking-wider flex-1">
          {t('social.online_title')}
          {list.status === 'ok' && people.length > 0 && (
            <span className="normal-case">{' · '}{people.length}</span>
          )}
        </p>
        <button
          type="button"
          onClick={toggleHidden}
          aria-label={t(hidden ? 'social.show_me' : 'social.hide_me')}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-brand-muted
                     hover:text-white transition-colors"
        >
          {hidden ? <IconEyeOff size={15} stroke={2} /> : <IconEye size={15} stroke={2} />}
        </button>
      </div>

      {hidden && (
        <p className="text-brand-muted text-[11px]">{t('social.hidden_note')}</p>
      )}

      {list.status === 'loading' && (
        <p className="text-brand-muted/70 text-sm">{t('social.online_loading')}</p>
      )}
      {list.status === 'error' && (
        <p className="text-red-400/80 text-[10.5px]">{t('social.online_failed')}</p>
      )}
      {list.status === 'ok' && people.length === 0 && (
        <p className="text-brand-muted/70 text-sm">{t('social.online_empty')}</p>
      )}

      {people.length > 0 && (
        <ul className="space-y-2">
          {people.map((p) => (
            <li
              key={p.player_id}
              className="flex items-center gap-3 rounded-xl bg-brand-bg border border-brand-border px-3 py-2"
            >
              <Avatar name={nameOf(p)} src={p.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm truncate">{nameOf(p)}</p>
                {p.is_friend && (
                  <p className="text-brand-accent text-[11px]">{t('social.is_friend')}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => invite(p.player_id)}
                disabled={!room || busy === p.player_id}
                aria-label={t('social.invite')}
                title={room ? undefined : t('social.invite_needs_room')}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-brand-muted
                           hover:text-white transition-colors disabled:opacity-40"
              >
                {busy === p.player_id
                  ? <IconLoader2 size={15} stroke={2} className="animate-spin" />
                  : <IconUserPlus size={15} stroke={2} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!room && people.length > 0 && (
        <p className="text-brand-muted/70 text-[11px]">{t('social.invite_needs_room')}</p>
      )}
    </section>
  );
}
