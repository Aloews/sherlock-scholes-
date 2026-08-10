import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconUserPlus, IconLoader2 } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { Button } from '@/shared/ui/Button';
import { useFriends } from '@/features/friends/useFriends';
import { displayName } from '@/features/friends/friendsApi';
import { getRawInitData, hapticImpact, hapticError } from '@/shared/lib/telegram';
import { inviteToRoom } from './inviteApi';

/**
 * Pull a friend into this room by name.
 *
 * THE POINT IS THAT NO CODE IS INVOLVED. Reading six characters aloud and
 * having them typed back is the step that fails — O against 0, I against 1, a
 * field under the keyboard — and it fails as "the code doesn't work". Here the
 * host taps a name and the other player finds an invitation on their home
 * screen; joining is one tap on their side too.
 *
 * The link and the QR code stay: this only covers people the game already
 * knows you have played with, and a stranger still needs one of those.
 *
 * PER-ROW STATE, NOT A PANEL-WIDE SPINNER. Inviting four people is the normal
 * case, and a single "sending…" would make the second tap look ignored.
 */
export function InviteFriendsPanel({ roomId, playerId }: { roomId: string; playerId: number | null }) {
  const { t } = useTranslation();
  const { friends, loading } = useFriends(playerId);
  const [sending, setSending] = useState<number | null>(null);
  const [invited, setInvited] = useState<Record<number, boolean>>({});

  // Nothing to show and nothing to explain: somebody with no friends yet has
  // the link and the QR above, and an empty box under them is just noise.
  if (loading || friends.length === 0) return null;

  const send = async (friendId: number) => {
    setSending(friendId);
    const ok = await inviteToRoom(getRawInitData(), roomId, friendId);
    setSending(null);
    // A refusal is a real answer — the room may have started, or they may
    // already be in it — so it must not draw a tick.
    if (ok) {
      setInvited((prev) => ({ ...prev, [friendId]: true }));
      hapticImpact('light');
    } else {
      hapticError();
    }
  };

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3 animate-fade-in">
      {/* `lobby.invite_friends` is taken — it is the hint under the code, and
          it says to SHARE the code. This panel is the opposite of that. */}
      <p className="text-brand-muted text-sm">{t('lobby.invite_pick')}</p>

      <div className="space-y-2">
        {friends.map((friend) => (
          <div key={friend.player_id} className="flex items-center gap-3">
            <Avatar name={displayName(friend)} src={friend.avatar_url ?? undefined} size="sm" />
            <p className="flex-1 min-w-0 truncate text-white text-sm">{displayName(friend)}</p>

            {invited[friend.player_id] ? (
              <span className="flex items-center gap-1 text-brand-muted text-xs shrink-0">
                <IconCheck size={16} stroke={2} />
                {t('lobby.invite_sent')}
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={sending !== null}
                onClick={() => { void send(friend.player_id); }}
              >
                {sending === friend.player_id
                  ? <IconLoader2 size={16} stroke={2} className="animate-spin" />
                  : <IconUserPlus size={16} stroke={2} />}
                {t('lobby.invite_action')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
