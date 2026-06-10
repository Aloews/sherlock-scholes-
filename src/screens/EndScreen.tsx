import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconSend } from '@tabler/icons-react';
import { useGameStore } from '@/shared/store/gameStore';
import { Button } from '@/shared/ui/Button';
import { hapticSuccess, hapticImpact } from '@/shared/lib/telegram';
import { playSound } from '@/shared/lib/sounds';
import type { TeamScore } from '@/shared/types/database';

const INVITES = [
  'Сыграй со мной в Шерлок Скоулс — угадай легенду футбола! ⚽',
  'Думаешь, знаешь футбол? Проверь в Шерлок Скоулс ⚽',
  'Объясни футболиста, не называя имени. Слабо? Шерлок Скоулс ⚽',
  'Лучшая игра для футбольной компании — Шерлок Скоулс ⚽',
  'Кто из нас знает футбол лучше? Зацени Шерлок Скоулс ⚽',
  'Угадай легенду по подсказкам — Шерлок Скоулс ⚽',
  'Собери друзей и проверьте, кто настоящий знаток футбола ⚽',
  'Один объясняет — другой угадывает. Футбольный Alias: Шерлок Скоулс ⚽',
];

const BOT_LINK = 'https://t.me/sherlock_scholes_bot';

/** Animated running score (rises from 0 with ease-out). */
function AnimatedCounter({ value, duration = 1.2 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed  = (Date.now() - start) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration]);
  return <>{display}</>;
}

/** Invented club crest — shape chosen deterministically from the team name. */
function TeamCrest({ name, color, size = 56 }: { name: string; color: string; size?: number }) {
  const shapes = ['shield', 'circle', 'diamond', 'hexagon'] as const;
  const sum   = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const shape = shapes[sum % shapes.length];

  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase() || '?';

  const shapeEl =
    shape === 'circle' ? (
      <circle cx={25} cy={29} r={22} fill="#13182A" stroke={color} strokeWidth={2.5} />
    ) : (
      <path
        d={
          shape === 'shield'
            ? 'M5 5 H45 V32 Q45 50 25 56 Q5 50 5 32 Z'
            : shape === 'diamond'
              ? 'M25 4 L46 29 L25 54 L4 29 Z'
              : 'M25 4 L44 15 L44 43 L25 54 L6 43 L6 15 Z'
        }
        fill="#13182A"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    );

  return (
    <svg width={size} height={(size * 60) / 50} viewBox="0 0 50 60" aria-hidden="true">
      {shapeEl}
      <text
        x="25"
        y="29"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="17"
        fontWeight="800"
        fill={color}
      >
        {initials}
      </text>
    </svg>
  );
}

/** Outline trophy hero icon. */
function TrophyOutline() {
  return (
    <svg
      width="60"
      height="60"
      viewBox="0 0 40 40"
      fill="none"
      stroke="#FF6300"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8h16v6a8 8 0 0 1-16 0zM20 22v6M14 31h12M16 31l1.5-3M24 31l-1.5-3" />
    </svg>
  );
}

export function EndScreen() {
  const navigate = useNavigate();
  const { room, teams, teamScores, scores, roomPlayers, reset } = useGameStore();
  const { t } = useTranslation();

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      hapticSuccess();
      playSound('fanfare');
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const sorted  = [...teamScores].sort((a, b) => b.total_points - a.total_points);
  const winner  = sorted[0];
  const isDraw  = sorted.length >= 2 && sorted[0].total_points === sorted[1].total_points;
  const is1v1   = room?.mode === '1v1';

  const allRoundsData = teams.map((team) => {
    const teamRoundScores = scores.filter((s) => s.team_id === team.id);
    return { team, rounds: teamRoundScores };
  });

  const isWinnerTeam = (ts: TeamScore) => !isDraw && ts.team_id === winner?.team_id;

  const handlePlayAgain = () => {
    reset();
    navigate('/');
  };

  const handleShare = () => {
    hapticImpact('medium');
    const text = INVITES[Math.floor(Math.random() * INVITES.length)];
    const url  = `https://t.me/share/url?url=${encodeURIComponent(BOT_LINK)}&text=${encodeURIComponent(text)}`;

    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col overflow-y-auto">
      {/* Trophy hero */}
      <div
        className={`flex flex-col items-center pt-12 pb-6 px-6 transition-all duration-700 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <TrophyOutline />
        <p className="text-brand-accent text-xs font-bold uppercase tracking-[0.25em] mt-4">
          {isDraw ? t('end.draw_eyebrow') : t('end.win_eyebrow')}
        </p>
        <h1 className="text-3xl font-black text-white text-center mt-2">
          {isDraw ? t('end.draw') : t('end.wins', { name: winner?.team_name })}
        </h1>
      </div>

      {/* Team crests + scores */}
      <div className={`px-4 transition-all duration-700 delay-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        {sorted.length === 2 ? (
          <div className="flex items-center justify-center gap-5">
            {sorted.map((ts, i) => (
              <div key={ts.team_id} className="flex items-center gap-5">
                {i === 1 && <span className="text-3xl font-black text-brand-muted">:</span>}
                <div className={`flex flex-col items-center gap-2 ${isWinnerTeam(ts) ? '' : 'opacity-[0.66]'}`}>
                  <TeamCrest name={ts.team_name} color={ts.color} />
                  <span className="text-4xl font-black text-white leading-none">
                    <AnimatedCounter value={ts.total_points} />
                  </span>
                  <span className="text-sm font-semibold text-white text-center max-w-[6rem] truncate">
                    {ts.team_name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-w-md mx-auto">
            {sorted.map((ts) => (
              <div
                key={ts.team_id}
                className={`flex items-center gap-3 bg-brand-surface border border-brand-border rounded-2xl p-3 ${
                  isWinnerTeam(ts) ? '' : 'opacity-[0.66]'
                }`}
              >
                <TeamCrest name={ts.team_name} color={ts.color} size={44} />
                <span className="flex-1 text-base font-semibold text-white truncate">{ts.team_name}</span>
                <span className="text-3xl font-black text-white leading-none">
                  <AnimatedCounter value={ts.total_points} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 1v1 — competitive verdict */}
      {is1v1 && (
        <div className={`px-6 pt-5 text-center transition-all duration-700 delay-100 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-white text-lg font-bold">
            {isDraw
              ? t('end.duel_verdict_draw')
              : t('end.duel_verdict_win', { name: winner?.team_name })}
          </p>
        </div>
      )}

      {/* Per-round breakdown */}
      {allRoundsData.some((d) => d.rounds.length > 0) && (
        <div className={`px-4 mt-6 transition-all duration-700 delay-300 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-brand-muted text-sm uppercase tracking-wider mb-3">
            {t('end.round_breakdown')}
          </p>
          <div className="space-y-2">
            {allRoundsData.map(({ team, rounds }) => (
              <div key={team.id} className="bg-brand-surface rounded-2xl border border-brand-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
                  <span className="font-semibold text-white">{team.name}</span>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {rounds.map((r, i) => (
                    <div key={r.id} className="flex flex-col items-center gap-1">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-base ${
                        r.points >= 1
                          ? 'bg-brand-accent text-brand-bg'
                          : 'bg-transparent border-2 border-brand-border text-brand-muted'
                      }`}>
                        {i + 1}
                      </div>
                      <span className={`text-xs font-bold ${
                        r.points >= 1 ? 'text-brand-accent' : 'text-brand-muted'
                      }`}>
                        {r.points >= 1 ? `+${r.points}` : '0'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Players — hidden in 1v1 (crests already show players by name) */}
      {!is1v1 && (
        <div className={`px-4 mt-4 transition-all duration-700 delay-400 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-brand-muted text-sm uppercase tracking-wider mb-3">{t('end.players')}</p>
          <div className="bg-brand-surface rounded-2xl border border-brand-border p-4">
            <div className="flex flex-wrap gap-2">
              {roomPlayers.map((rp) => {
                const team = teams.find((tm) => tm.id === rp.team_id);
                return (
                  <div
                    key={rp.id}
                    className="flex items-center gap-2 bg-brand-border rounded-xl px-3 py-1"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: team?.color ?? '#1F2740' }}
                    />
                    <span className="text-sm text-white">
                      {rp.player?.first_name ?? t('end.player_default')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className={`px-4 py-8 mt-auto space-y-3 transition-all duration-700 delay-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        <Button fullWidth size="lg" onClick={handleShare}>
          <span className="flex items-center justify-center gap-2">
            <IconSend size={18} stroke={2} />
            {t('share.button')}
          </span>
        </Button>
        <Button fullWidth size="lg" variant="secondary" onClick={handlePlayAgain}>
          {t('end.play_again')}
        </Button>
      </div>
    </div>
  );
}
