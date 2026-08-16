import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { useDesign } from '@/shared/design/useDesign';
import { hapticImpact, setVerticalSwipes } from '@/shared/lib/telegram';
import { trackEvent } from '@/shared/lib/analytics';
import { ArenaPad } from '@/features/arena/ArenaPad';
import { useArena, WIN_SCORE } from '@/features/arena/useArena';
import { useArenaGuest } from '@/features/arena/useArenaGuest';
import { useArenaNet, type NetRole } from '@/features/arena/useArenaNet';
import {
  clampMove, sideFor, toSnapshot, SNAPSHOT_HZ,
  type InputMessage, type Snapshot,
} from '@/features/arena/net';
import { CODE_LENGTH, sanitizeCodeInput } from '@/features/lobby/invite';
import {
  fitCanvas, readPalette, render, VIEW_ASPECT, type Palette,
} from '@/features/arena/render';
import type { ArenaState } from '@/features/arena/physics';

/**
 * Арена на двух телефонах.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ РЕШЕНИЯ «СЕТЕВОЙ АРЕНЫ НЕ БУДЕТ». То решение
 * (docs/MAP.md §4) отвергает СИНХРОННУЮ физику: два телефона считают один шаг
 * и ждут друг друга, а замер этого проекта — 150–300 мс между континентами.
 * Здесь шаг считает только хост, гость шлёт ему ввод и рисует присланное с
 * задержкой в один интервал снимков, предсказывая одну лишь свою ракетку.
 * Такая схема живёт на сотнях миллисекунд — тем же способом, каким живут все
 * сетевые игры, кроме файтингов.
 *
 * ОТДЕЛЬНЫЙ РОУТ, А НЕ РЕЖИМ ВНУТРИ АРЕНЫ. Состояний тут своих четыре
 * (набор кода, ожидание, игра, соперник ушёл), и вложить их в экран, у
 * которого уже есть свои, — это тот самый маршрутизатор внутри
 * маршрутизатора, на который проект жалуется в §8а карты.
 */
export function ArenaOnlineScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const design = useDesign();

  const [code, setCode] = useState<string | null>(null);
  const [role, setRole] = useState<NetRole>('host');
  const [draft, setDraft] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Palette | null>(null);
  const chargingRef = useRef({ left: false, right: false });

  const draw = useCallback((state: ArenaState) => {
    const canvas = canvasRef.current;
    const palette = paletteRef.current;
    if (!canvas || !palette) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    render(ctx, state, palette, fitCanvas(canvas), { charging: chargingRef.current });
  }, []);

  // Ввод гостя кладётся в ту же ячейку, из которой его читал бы второй палец
  // на одном телефоне. Физика не знает и не должна знать, что игрок далеко.
  const hostInputsRef = useRef<{ apply(m: InputMessage): void } | null>(null);
  const guestPushRef = useRef<((s: Snapshot) => void) | null>(null);

  const net = useArenaNet({
    code,
    role,
    onInput: useCallback((m: InputMessage) => hostInputsRef.current?.apply(m), []),
    onSnapshot: useCallback((s: Snapshot) => guestPushRef.current?.(s), []),
  });

  const host = useArena(draw);
  const guest = useArenaGuest(draw, net);

  const isHost = role === 'host';
  const inputsRef = isHost ? host.inputsRef : guest.inputsRef;
  const score = isHost ? host.score : guest.score;
  const mySide = sideFor(isHost);

  // Связываем колбэки сети с активной половиной. Через ref, потому что сам
  // канал поднимается один раз за код и не должен пересобираться на рендере.
  useEffect(() => {
    hostInputsRef.current = {
      apply(m) {
        // ⚠️ Пришедшее с чужого устройства зажимается ДО физики: вектор
        // длиной 100 увёз бы игрока через всё поле за один кадр.
        host.inputsRef.current.right.move = clampMove(m.mx, m.my);
        host.inputsRef.current.right.kick = m.kick;
      },
    };
    guestPushRef.current = guest.pushSnapshot;
  }, [host.inputsRef, guest.pushSnapshot]);

  // Хост рассылает снимки. Двадцать раз в секунду, а не шестьдесят: между
  // снимками гость интерполирует, и разницы не видно, а трафика втрое меньше.
  useEffect(() => {
    if (!isHost || net.status !== 'playing') return;
    const id = setInterval(() => {
      net.sendSnapshot(toSnapshot(host.stateRef.current, Date.now(), 0));
    }, 1000 / SNAPSHOT_HZ);
    return () => clearInterval(id);
  }, [isHost, net.status, net, host.stateRef]);

  useEffect(() => {
    paletteRef.current = readPalette(document.documentElement);
  }, [design]);

  // Джойстик тянут вниз, а свайп вниз сворачивает мини-приложение.
  useEffect(() => {
    setVerticalSwipes(false);
    return () => setVerticalSwipes(true);
  }, []);

  useEffect(() => { trackEvent('arena_online_open', {}); }, []);

  const newCode = useMemo(
    () => () => {
      // Без похожих на вид символов: код диктуют голосом и переписывают руками.
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let out = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        out += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return out;
    },
    [],
  );

  if (!code) {
    return (
      <div className="min-h-screen bg-brand-bg ds-screen">
        <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="text-brand-muted hover:text-white transition-colors"
              aria-label={t('home.back')}
            >
              <IconArrowLeft size={22} stroke={1.5} />
            </button>
            <h1 className="ds-display text-white text-lg font-black">{t('arena.online_title')}</h1>
          </div>

          <p className="text-brand-muted text-sm">{t('arena.online_intro')}</p>

          <Button
            onClick={() => { hapticImpact('light'); setRole('host'); setCode(newCode()); }}
          >
            {t('arena.online_create')}
          </Button>

          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
            <p className="text-brand-muted text-xs">{t('arena.online_join_hint')}</p>
            <input
              value={draft}
              // Держим в состоянии то, что уже является кодом: иначе
              // управляемое поле спорит с клавиатурой, и на Android пропадает
              // символ, вызвавший переписывание.
              onChange={(e) => setDraft(sanitizeCodeInput(e.target.value))}
              inputMode="text"
              autoCapitalize="characters"
              maxLength={CODE_LENGTH}
              placeholder={t('arena.online_code_placeholder')}
              className="w-full bg-brand-bg border border-brand-border rounded-xl px-3 py-2 text-white tracking-[0.3em] text-center uppercase"
            />
            <Button
              disabled={draft.length < CODE_LENGTH}
              onClick={() => { hapticImpact('light'); setRole('guest'); setCode(draft); }}
            >
              {t('arena.online_join')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={1.5} />
        </button>
        <h1 className="ds-display text-white text-base font-black flex-1">
          {t('arena.online_title')}
        </h1>
        <span className="ds-display text-white text-sm font-black tracking-[0.25em]">{code}</span>
      </div>

      <div className="flex items-center justify-center gap-4 px-4 pb-2" aria-live="polite">
        <span className="ds-display text-2xl font-black tabular-nums" style={{ color: 'rgb(var(--team-left))' }}>
          {score.left}
        </span>
        <span className="text-brand-muted text-sm">:</span>
        <span className="ds-display text-2xl font-black tabular-nums" style={{ color: 'rgb(var(--team-right))' }}>
          {score.right}
        </span>
      </div>

      <div className="relative px-2 flex-1 flex flex-col justify-center min-h-0">
        <canvas
          ref={canvasRef}
          className="w-full rounded-2xl"
          style={{ aspectRatio: String(VIEW_ASPECT) }}
          aria-label={t('arena.pitch_aria')}
        />

        {/* Состояние связи поверх поля. Молчание канала само по себе ничего
            не говорит: «соперник вышел» и «моргнула сеть» выглядят одинаково,
            и только presence отвечает, что именно случилось. */}
        {net.status !== 'playing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-brand-bg/80 rounded-2xl px-6 text-center">
            <p className="text-white text-sm">
              {net.status === 'waiting' && t('arena.online_waiting')}
              {net.status === 'connecting' && t('arena.online_connecting')}
              {net.status === 'left' && t('arena.online_left')}
              {net.status === 'error' && t('arena.online_error')}
            </p>
            {net.status === 'waiting' && (
              <p className="text-brand-muted text-xs">{t('arena.online_share_code', { code })}</p>
            )}
          </div>
        )}
      </div>

      {/* Одна площадка, а не две: телефон теперь у каждого свой, и вторая
          управляла бы игроком, которого на этом устройстве нет. */}
      <div className="h-[40vh] min-h-[180px] max-h-[280px] shrink-0 flex items-stretch px-2 pb-4">
        <ArenaPad
          side={mySide}
          input={inputsRef.current[mySide]}
          onKickChange={(down) => { chargingRef.current[mySide] = down; }}
          label={t(`arena.team_${mySide}`)}
          kickLabel={t('arena.kick')}
          color={`rgb(var(--team-${mySide}))`}
        />
      </div>

      <div className="px-6 pb-3">
        <p className="text-brand-muted text-[11px] text-center">
          {t('arena.rules', { count: WIN_SCORE, n: WIN_SCORE })}
        </p>
      </div>
    </div>
  );
}
