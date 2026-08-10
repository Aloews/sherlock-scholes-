import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { Button } from '@/shared/ui/Button';
import { getRawInitData, hapticImpact } from '@/shared/lib/telegram';
import { declineInvite, fetchPendingInvites, type PendingInvite } from './inviteApi';

/**
 * "Женя зовёт играть" — the invitations waiting on the home screen.
 *
 * This is the other half of InviteFriendsPanel, and together they are the
 * whole point: a player who has been invited never sees a room code at all.
 * One tap joins.
 *
 * IT HANDS BACK A CODE, NOT A ROOM. Joining goes through exactly the same path
 * a typed code does, so there is one way into a room and not two — the second
 * one is always the one that rots.
 *
 * Renders nothing when there is nothing waiting, including while it is still
 * finding out. An empty "no invitations" box on the home screen would be a
 * permanent reminder of an absence.
 */
export function PendingInvitesPanel({ onJoin }: { onJoin: (code: string) => void }) {
  const { t } = useTranslation();
  const [invites, setInvites] = useState<PendingInvite[]>([]);

  const load = useCallback(async () => {
    setInvites(await fetchPendingInvites(getRawInitData()));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dismiss = async (roomId: string) => {
    hapticImpact('light');
    // Dropped from the list first: the row is gone either way, and waiting for
    // the round trip leaves a button that looks broken on a slow connection.
    setInvites((prev) => prev.filter((i) => i.room_id !== roomId));
    await declineInvite(getRawInitData(), roomId);
  };

  if (invites.length === 0) return null;

  return (
    <div className="w-full space-y-2 animate-fade-in">
      {invites.map((invite) => {
        const name = `${invite.first_name} ${invite.last_name ?? ''}`.trim();
        return (
          <div
            key={invite.room_id}
            className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center gap-3"
          >
            <Avatar name={name} src={invite.avatar_url ?? undefined} size="sm" />

            <div className="flex-1 min-w-0">
              <p className="text-white text-sm truncate">{t('home.invite_from', { name })}</p>
              <p className="text-brand-muted text-xs">
                {t('home.invite_in_room', { n: invite.players })}
              </p>
            </div>

            <Button
              size="sm"
              onClick={() => { hapticImpact('medium'); onJoin(invite.code); }}
            >
              {t('home.invite_join')}
            </Button>

            <button
              type="button"
              onClick={() => { void dismiss(invite.room_id); }}
              className="text-brand-muted hover:text-white transition-colors p-1 shrink-0"
              aria-label={t('home.invite_decline')}
            >
              <IconX size={16} stroke={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
