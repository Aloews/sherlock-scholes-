import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconUserPlus, IconLoader2, IconShieldHalf } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { Button } from '@/shared/ui/Button';
import { getRawInitData, hapticImpact, hapticError } from '@/shared/lib/telegram';
import { inviteToRoom, fetchClubFansToInvite, type ClubFan } from './inviteApi';

/**
 * Позвать своих по клубу.
 *
 * ЗАЧЕМ ОТДЕЛЬНОЙ ПАНЕЛЬЮ, А НЕ СТРОКАМИ В СПИСКЕ ДРУЗЕЙ. Друг — это тот, с
 * кем уже играли; болельщик одного клуба — тот, с кем не играли ни разу, и
 * зовут его по другому поводу: идёт матч наших. Смешать два списка значило бы
 * потерять этот повод, а он и есть причина нажать.
 *
 * ⚠️ ПУСТО — ЭТО НОРМА, И ПАНЕЛЬ ТОГДА НЕ ПОЯВЛЯЕТСЯ. Своих онлайн может не
 * быть вовсе; пустая коробка под кодом комнаты — шум, а не сообщение. Та же
 * причина, по которой прячет себя список друзей.
 *
 * ПОСТРОЧНОЕ СОСТОЯНИЕ, А НЕ ОДИН СПИННЕР НА ПАНЕЛЬ: позвать четверых — это
 * обычный случай, и общий «отправляю…» сделал бы второе нажатие похожим на
 * пропущенное.
 */
export function InviteFansPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const [fans, setFans] = useState<ClubFan[]>([]);
  const [sending, setSending] = useState<number | null>(null);
  const [invited, setInvited] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void fetchClubFansToInvite(getRawInitData(), roomId).then((r) => {
      if (!cancelled && r.status === 'ok') setFans(r.data);
    });
    return () => { cancelled = true; };
  }, [roomId]);

  if (fans.length === 0) return null;

  const send = async (id: number) => {
    setSending(id);
    const ok = await inviteToRoom(getRawInitData(), roomId, id);
    setSending(null);
    // Отказ — настоящий ответ: комната могла начаться. Галочку он не рисует.
    if (ok) {
      setInvited((prev) => ({ ...prev, [id]: true }));
      hapticImpact('light');
    } else {
      hapticError();
    }
  };

  const name = (f: ClubFan) => [f.first_name, f.last_name].filter(Boolean).join(' ');

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3 animate-fade-in">
      <p className="text-brand-muted text-sm flex items-center gap-1.5">
        <IconShieldHalf size={15} stroke={1.75} />
        {t('lobby.invite_fans')}
      </p>

      <div className="space-y-2">
        {fans.map((f) => (
          <div key={f.player_id} className="flex items-center gap-3">
            <Avatar name={name(f)} src={f.avatar_url ?? undefined} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-white text-sm">{name(f)}</p>
              {/* Клуб подписан у каждого: своих может быть из разных клубов,
                  и без подписи непонятно, кого и по какому поводу зовут. */}
              <p className="truncate text-brand-muted text-[10.5px]">{f.club}</p>
            </div>
            <Button
              size="sm"
              variant={invited[f.player_id] ? 'ghost' : 'secondary'}
              disabled={sending === f.player_id || invited[f.player_id]}
              onClick={() => void send(f.player_id)}
            >
              {sending === f.player_id
                ? <IconLoader2 size={15} className="animate-spin" />
                : invited[f.player_id]
                  ? <IconCheck size={15} />
                  : <IconUserPlus size={15} />}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
