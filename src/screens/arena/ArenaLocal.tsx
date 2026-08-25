import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { useDesign } from '@/shared/design/useDesign';
import { hapticImpact, hapticSuccess, setVerticalSwipes } from '@/shared/lib/telegram';
import { trackEvent } from '@/shared/lib/analytics';
import { ArenaPad } from '@/features/arena/ArenaPad';
import { useArena, WIN_SCORE, type Side } from '@/features/arena/useArena';
import {
  fitCanvas, readPalette, render, VIEW_ASPECT, type Palette,
} from '@/features/arena/render';
import type { ArenaState } from '@/features/arena/physics';

/**
 * Арена — футбол на двоих на одном телефоне.
 *
 * ОДИН ТЕЛЕФОН, ДВЕ КОМАНДЫ — это премиса всего приложения, и здесь она
 * взята буквально: телефон кладут между двумя людьми.
 *
 * Игра на двух телефонах живёт рядом, на /arena/online, и физику там считает
 * только хост. Синхронного варианта — где оба устройства считают один шаг и
 * ждут друг друга — по-прежнему нет и не будет: он требует 60 обменов в
 * секунду при задержке в единицы миллисекунд, а замер этого проекта в
 * docs/VIDEOCHAT_HANDOFF.md даёт 150–300 мс между континентами.
 *
 * ЭКРАН НЕ ПЕРЕРИСОВЫВАЕТСЯ ПО КАДРАМ. Игра живёт в canvas и в ref'ах; через
 * React проходят только события — счёт, гол, победа. Иначе шестьдесят
 * рендеров в секунду грели бы телефон ради картинки, которую canvas рисует
 * сам.
 */
export function ArenaLocal({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const design = useDesign();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Palette | null>(null);
  // Кольцо заряда рисуется по кадру, поэтому состояние кнопок живёт в ref, а
  // не в useState: нажатие и так меняет вид, но перерисовывать ради него
  // дерево незачем.
  const chargingRef = useRef({ left: false, right: false });

  const draw = useCallback((state: ArenaState) => {
    const canvas = canvasRef.current;
    const palette = paletteRef.current;
    if (!canvas || !palette) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    render(ctx, state, palette, fitCanvas(canvas), { charging: chargingRef.current });
  }, []);

  const { inputsRef, score, celebrating, winner, restart } = useArena(draw);

  // Палитра снимается с документа и перечитывается при смене дизайна: цвета
  // живут в CSS-переменных, а canvas их сам не видит.
  useEffect(() => {
    paletteRef.current = readPalette(document.documentElement);
  }, [design]);

  // Свайп вниз по умолчанию сворачивает мини-приложение, а джойстик тянут
  // вниз каждые несколько секунд. Возвращается как было при уходе с экрана:
  // запрет глобальный, и оставить его включённым значит сломать прокрутку
  // всем остальным экранам.
  useEffect(() => {
    setVerticalSwipes(false);
    return () => setVerticalSwipes(true);
  }, []);

  useEffect(() => { trackEvent('arena_open', {}); }, []);

  // Нажатие кнопки удара НЕ ИДЁТ ЧЕРЕЗ REACT ВООБЩЕ. Его видно только на
  // поле — кольцом вокруг игрока, — а поле рисует canvas по этому же ref.
  // Заводить здесь состояние значило бы перерисовывать дерево ради того, что
  // React всё равно не рисует.
  const onKickChange = (side: Side) => (down: boolean) => {
    chargingRef.current[side] = down;
  };

  useEffect(() => {
    if (celebrating) hapticImpact('heavy');
  }, [celebrating]);

  useEffect(() => {
    if (!winner) return;
    hapticSuccess();
    trackEvent('arena_finish', { winner, left: score.left, right: score.right });
    // score меняется вместе с winner в одном голе, поэтому в зависимостях его
    // нет: он бы отправил событие ещё раз на следующем голе, которого не будет.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner]);

  const teamName = (side: Side) => t(side === 'left' ? 'arena.team_left' : 'arena.team_right');

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); onBack(); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-lg font-black flex-1">{t('arena.title')}</h1>
        <button
          type="button"
          onClick={() => { hapticImpact('light'); restart(); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('arena.restart')}
        >
          <IconRefresh size={19} stroke={2} />
        </button>
      </div>

      {/* Счёт. Цвета команд — те же переменные, что и на поле, поэтому кто
          есть кто видно без легенды. */}
      <div className="flex items-center justify-center gap-4 px-4 pb-2" aria-live="polite">
        <span className="text-[11px] uppercase tracking-wider" style={{ color: 'rgb(var(--team-left))' }}>
          {teamName('left')}
        </span>
        <span className="ds-display text-white text-2xl font-black tabular-nums">
          {score.left} : {score.right}
        </span>
        <span className="text-[11px] uppercase tracking-wider" style={{ color: 'rgb(var(--team-right))' }}>
          {teamName('right')}
        </span>
      </div>

      {/* Поле центрируется в том, что осталось. 16:9 во всю ширину телефона —
          это меньше трети экрана по высоте, и прижатое к шапке оно висит с
          пустотой под собой. */}
      <div className="relative px-2 flex-1 flex flex-col justify-center min-h-0">
        <canvas
          ref={canvasRef}
          className="w-full block rounded-2xl"
          style={{ aspectRatio: String(VIEW_ASPECT) }}
          role="img"
          aria-label={t('arena.pitch_aria')}
        />

        {/* Гол. Поверх замершего кадра, где мяч лежит в сетке. */}
        {celebrating && !winner && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p
              className="ds-display text-4xl font-black animate-slide-up"
              style={{ color: `rgb(var(--team-${celebrating}))` }}
            >
              {t('arena.goal')}
            </p>
          </div>
        )}

        {winner && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-brand-bg/80 rounded-2xl px-6">
            <p
              className="ds-display text-2xl font-black text-center"
              style={{ color: `rgb(var(--team-${winner}))` }}
            >
              {t('arena.winner', { team: teamName(winner) })}
            </p>
            <p className="text-brand-muted text-sm">{score.left} : {score.right}</p>
            <Button onClick={() => { hapticImpact('light'); restart(); }}>
              {t('arena.again')}
            </Button>
          </div>
        )}
      </div>

      <div className="px-6 py-2 space-y-0.5">
        <p className="text-brand-muted text-[11px] text-center">
          {t('arena.rules', { count: WIN_SCORE, n: WIN_SCORE })}
        </p>
        {/* Кто с кем играет, сказано словами один раз. Две площадки внизу
            выглядят как один пульт, если не объяснить, что их две. */}
        <p className="text-brand-muted/60 text-[11px] text-center">{t('arena.hint')}</p>
      </div>

      {/* Управление. Левая половина — левой команде, правая — правой: телефон
          лежит между двумя людьми, и чужая половина не должна оказаться под
          рукой.

          ЗАБИРАЕТ ВСЮ ОСТАВШУЮСЯ ВЫСОТУ (flex-1), а не прижимается к низу
          через mt-auto. Поле 16:9 занимает по высоте меньше трети экрана
          телефона, и площадки, прижатые к низу, оставляли между собой и полем
          около 380 пикселей пустоты — почти половину экрана. Ни один тест
          такого не видит: разметка валидна, все элементы на месте.

          Пустоту делят поле и площадки: площадкам столько, сколько нужно
          большому пальцу, остальное уходит полю, которое центрируется выше.
          Потолок здесь нужен — площадка во весь оставшийся экран съедала бы
          две трети высоты под два круга. */}
      <div className="h-[46vh] min-h-[190px] max-h-[300px] shrink-0 flex items-stretch gap-2 px-2 pb-4">
        <ArenaPad
          side="left"
          input={inputsRef.current.left}
          onKickChange={onKickChange('left')}
          label={teamName('left')}
          kickLabel={t('arena.kick')}
          color="rgb(var(--team-left))"
        />
        <ArenaPad
          side="right"
          input={inputsRef.current.right}
          onKickChange={onKickChange('right')}
          label={teamName('right')}
          kickLabel={t('arena.kick')}
          color="rgb(var(--team-right))"
        />
      </div>

    </div>
  );
}
