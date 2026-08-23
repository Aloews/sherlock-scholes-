import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconX, IconUsers, IconChevronRight, IconFlame } from '@tabler/icons-react';
import { Avatar } from '@/shared/ui/Avatar';
import { useAuthStore } from '@/shared/store/authStore';
import { usePlayerStats } from '@/features/game/usePlayerStats';
import { hapticImpact } from '@/shared/lib/telegram';
import { levelProgress, levelTitleKey } from '@/shared/lib/level';
import { WeeklyQuests } from '@/screens/profile/WeeklyQuests';
import { SoundCheckPanel } from '@/features/voice/SoundCheckPanel';
import { VoiceServicesPanel } from '@/features/voice/VoiceServicesPanel';

// Phase 1 of the progression handoff (docs/PROGRESSION_FEATURES_HANDOFF.md):
// avatar, level + rank title, xp progress bar. The achievement ribbon and
// settings rows from the prototype's `isProfile` section land in phase 2,
// once achievements exist to fill them — see TODO(profile-v2) below.
export function ProfileScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { player } = useAuthStore();
  const { stats, loading, reload } = usePlayerStats(player?.id ?? null);

  const name = player ? `${player.first_name} ${player.last_name ?? ''}`.trim() : '';
  const progress = levelProgress(stats?.xp ?? 0);
  // 0 means "never played" as much as "streak broken today" — either way
  // there is nothing honest to show yet, so the row stays hidden rather
  // than asserting a streak that does not exist (docs/MAP.md §8а).
  const streak     = stats?.current_streak ?? 0;
  const bestStreak = stats?.longest_streak ?? 0;

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      {/* Header — same back-button pattern as /collection, so classic (which
          has no tab bar) can still reach and leave this screen. */}
      <div className="px-4 pt-8 pb-4 border-b border-brand-border">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/'); }}
            aria-label={t('home.back')}
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-brand-surface
                       border border-brand-border text-brand-muted hover:text-white transition-colors"
          >
            <IconX size={16} stroke={2} />
          </button>
          <h1 className="ds-display text-xl font-bold text-white">{t('profile.title')}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-sm mx-auto px-4 py-4 space-y-4">
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 flex items-center gap-3.5">
            {loading ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-brand-border/40 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-brand-border/40 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-brand-border/40 animate-pulse" />
                  <div className="h-1.5 w-full rounded-full bg-brand-border/40 animate-pulse mt-2" />
                </div>
              </>
            ) : (
              <>
                <Avatar name={name || '?'} src={player?.avatar_url} size="xl" className="rounded-2xl" />
                <div className="flex-1 min-w-0">
                  <p className="ds-display text-lg font-bold text-white truncate">{name}</p>
                  <p className="text-xs text-brand-muted mt-0.5">
                    {t('profile.level', { n: progress.level })} · {t(levelTitleKey(progress.level))}
                  </p>
                  <div className="h-1.5 rounded-full bg-brand-border overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${progress.pct}%`, background: 'var(--accent-gradient)' }}
                    />
                  </div>
                  <p className="text-[10.5px] text-brand-muted/80 mt-1.5">
                    {t('profile.xp_progress', { into: progress.xpIntoLevel, total: progress.xpForNextLevel })}
                  </p>
                  {streak > 0 && (
                    <p className="flex items-center gap-1 text-[10.5px] text-brand-accent mt-1">
                      <IconFlame size={12} stroke={2} />
                      {t('profile.streak', { count: streak })}
                      {bestStreak > streak && (
                        <span className="text-brand-muted/70">
                          · {t('profile.streak_best', { count: bestStreak })}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Weekly quests (phase 4). Claiming one awards xp server-side, so
              the header card is re-read afterwards rather than incremented
              locally — the bar must never disagree with the database. */}
          <WeeklyQuests playerId={player?.id ?? null} onClaimed={() => void reload()} />

          {/* Sound check. Here rather than in the lobby because it is a
              settings-shaped thing you do once on a new phone, and because a
              lobby with a live game behind it is the wrong place to open a
              microphone. Needs no voice provider configured — it never leaves
              the device. */}
          {/* Friends live on their own screen: the list is a ranking and the
              suggestions are a decision, and neither belongs squeezed under
              the stats card. */}
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/friends'); }}
            className="ds-panel w-full bg-brand-surface border border-brand-border rounded-2xl p-4
                       flex items-center gap-3 text-left hover:border-brand-accent transition-colors"
          >
            <span className="text-brand-accent shrink-0"><IconUsers size={20} stroke={1.75} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-white font-semibold">{t('friends.title')}</span>
              <span className="block text-[11px] text-brand-muted mt-0.5">{t('friends.entry_hint')}</span>
            </span>
            <span className="text-brand-muted shrink-0"><IconChevronRight size={16} stroke={2} /></span>
          </button>

          <SoundCheckPanel />

          {/* The other half of the same question. SoundCheckPanel settles the
              device; this settles the service — which one this build talks to,
              and whether the link to it is up. Together they cover both ends of
              "мне не слышно". */}
          <VoiceServicesPanel />

          {/* TODO(profile-v2): achievement ribbon (phase 2, once
              player_achievements exists) and the settings rows from the
              prototype's isProfile block go here, below the header card. */}
        </div>
      </div>
    </div>
  );
}
