import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconX, IconUserPlus, IconUserMinus, IconLoader2, IconTrophy } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { useAuthStore } from '@/shared/store/authStore';
import { useFriends } from '@/features/friends/useFriends';
import { displayName, type FriendRow, type SuggestionRow } from '@/features/friends/friendsApi';
import { hapticImpact, hapticSuccess, hapticError } from '@/shared/lib/telegram';
import { levelFromXp } from '@/shared/lib/level';
import { OnlinePanel } from '@/features/social/OnlinePanel';
import { FanClubsPanel } from '@/features/social/FanClubsPanel';

/**
 * Friends, ranked, and who to add next.
 *
 * The ranking axis is XP — the same number the profile already shows. A
 * second scoreboard with its own arithmetic would give one player two
 * different standings, and the player would be right to trust neither.
 *
 * Suggestions are only ever people the viewer actually shared a room with.
 * The game knows that for a fact; it does not know anything else about who
 * anybody knows, and it should not pretend to.
 */
export function FriendsScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { player } = useAuthStore();
  const { friends, suggestions, loading, failed, pending, add, remove } = useFriends(player?.id ?? null);

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="px-4 pt-8 pb-4 border-b border-brand-border">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/profile'); }}
            aria-label={t('home.back')}
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-brand-surface
                       border border-brand-border text-brand-muted hover:text-white transition-colors"
          >
            <IconX size={16} stroke={2} />
          </button>
          <h1 className="ds-display text-xl font-bold text-white">{t('friends.title')}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-sm mx-auto space-y-4">
          {loading && (
            <p className="text-brand-muted text-sm text-center py-8">{t('friends.loading')}</p>
          )}

          {/* «Пока никого» здесь никого не удивляет — у нового игрока друзей
              правда нет. Поэтому отказ, показанный той же надписью, не
              опознаётся вовсе, и у него теперь свой текст. */}
          {!loading && failed && (
            <p className="text-red-400/80 text-[10.5px] text-center pb-2">{t('friends.failed')}</p>
          )}

          {!loading && (
            <>
              {/* Кто сейчас в приложении — ПЕРВЫМ блоком: звать идут живых, а
                  не тех, кто последний раз заходил на прошлой неделе. */}
              <OnlinePanel />

              {/* Фан-клубы сразу под присутствием: «наших онлайн трое» имеет
                  смысл ровно рядом со списком тех, кто онлайн. */}
              <FanClubsPanel />

              <section className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
                <p className="text-brand-muted text-xs uppercase tracking-wider">
                  {t('friends.list_title')}
                </p>

                {friends.length === 0 ? (
                  <p className="text-brand-muted/70 text-sm">{t('friends.list_empty')}</p>
                ) : (
                  <ol className="space-y-2">
                    {friends.map((friend, index) => (
                      <FriendLine
                        key={friend.player_id}
                        rank={index + 1}
                        friend={friend}
                        busy={pending === friend.player_id}
                        onRemove={() => {
                          void remove(friend.player_id).then((ok) =>
                            ok ? hapticImpact('light') : hapticError());
                        }}
                      />
                    ))}
                  </ol>
                )}
              </section>

              {suggestions.length > 0 && (
                <section className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
                  <div>
                    <p className="text-brand-muted text-xs uppercase tracking-wider">
                      {t('friends.suggestions_title')}
                    </p>
                    <p className="text-brand-muted/70 text-[11px] mt-1">
                      {t('friends.suggestions_intro')}
                    </p>
                  </div>

                  <ul className="space-y-2">
                    {suggestions.map((person) => (
                      <SuggestionLine
                        key={person.player_id}
                        person={person}
                        busy={pending === person.player_id}
                        onAdd={() => {
                          void add(person.player_id).then((ok) =>
                            ok ? hapticSuccess() : hapticError());
                        }}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendLine({ rank, friend, busy, onRemove }: {
  rank: number;
  friend: FriendRow;
  busy: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const name = displayName(friend);

  return (
    <li className="flex items-center gap-3 rounded-xl bg-brand-bg border border-brand-border px-3 py-2">
      <span className="w-5 shrink-0 text-center text-brand-muted text-xs tabular-nums">{rank}</span>
      <Avatar name={name} src={friend.avatar_url} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm truncate">{name}</p>
        <p className="text-brand-muted text-[11px]">
          {t('friends.level_and_games', {
            level: levelFromXp(friend.xp),
            games: friend.games_played,
          })}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={t('friends.remove')}
        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-brand-muted
                   hover:text-white transition-colors disabled:opacity-50"
      >
        {busy
          ? <IconLoader2 size={15} stroke={2} className="animate-spin" />
          : <IconUserMinus size={15} stroke={2} />}
      </button>
    </li>
  );
}

function SuggestionLine({ person, busy, onAdd }: {
  person: SuggestionRow;
  busy: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const name = displayName(person);

  return (
    <li className="flex items-center gap-3 rounded-xl bg-brand-bg border border-brand-border px-3 py-2">
      <Avatar name={name} src={person.avatar_url} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm truncate">{name}</p>
        {/* The reason this person is here, said out loud. A suggestion whose
            grounds are invisible reads as the app guessing about your life. */}
        <p className="text-brand-muted text-[11px] flex items-center gap-1">
          <IconTrophy size={11} stroke={2} className="shrink-0" />
          {t('friends.played_together', { games: person.games_together })}
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        aria-label={t('friends.add')}
        className="h-8 px-3 shrink-0 flex items-center gap-1.5 rounded-lg border border-brand-accent/40
                   bg-brand-accent/10 text-white text-xs transition-colors disabled:opacity-50"
      >
        {busy
          ? <IconLoader2 size={14} stroke={2} className="animate-spin" />
          : <IconUserPlus size={14} stroke={2} />}
        {t('friends.add')}
      </button>
    </li>
  );
}
