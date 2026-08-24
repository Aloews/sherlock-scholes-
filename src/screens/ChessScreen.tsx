import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconArrowLeft, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { hapticImpact, hapticError } from '@/shared/lib/telegram';
import {
  BOARD_H, BOARD_W, WIN_GOALS,
  applyMove, initialState, legalMoves, ownGoalRow, isGoalSquare, pieceAt, pieceById,
  sameSquare, winner,
  type ChessState, type Line, type Move, type Piece, type Side, type Square,
} from '@/features/chess/rules';

/**
 * «Футбольные шахматы» — настолка на двоих НА ОДНОМ ТЕЛЕФОНЕ.
 *
 * Правила целиком живут в features/chess/rules.ts и там же покрыты тестами;
 * этот файл ничего о них не знает сверх того, что вернул `legalMoves`. Это не
 * аккуратность ради аккуратности: подсветка клеток и сам ход обязаны считаться
 * ОДНИМ кодом, иначе подсветится одно, а исполнится другое, и заметить это
 * можно будет только пальцем.
 *
 * ДОСКА НЕ ПЕРЕВОРАЧИВАЕТСЯ между ходами, и это выбор. Телефон лежит на столе
 * между двумя игроками, они смотрят на него с разных сторон — и переворот,
 * задуманный как удобство, отнял бы у обоих привычку к позиции: у соперника
 * фигуры прыгали бы через всё поле каждый ход. Чей сейчас ход, говорит цвет
 * в шапке, а не ориентация поля.
 *
 * ⚠️ БЕЗ PageTransition (см. роут). Причина та же, что у арены: обёртка
 * анимирует transform родителя, и первые касания уезжали бы вместе с ним —
 * а здесь каждое касание попадает в конкретную клетку.
 */

/** Цвета сторон. Не из палитры темы: это две КОМАНДЫ, а не состояния UI. */
const SIDE_STYLE: Record<Side, { chip: string; dot: string; text: string }> = {
  home: {
    chip: 'bg-sky-500/15 border-sky-400/50',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
  },
  away: {
    chip: 'bg-rose-500/15 border-rose-400/50',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
  },
};

export function ChessScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [state, setState] = useState<ChessState>(() => initialState('home'));
  const [selected, setSelected] = useState<string | null>(null);

  const moves = useMemo(() => legalMoves(state), [state]);

  /** Ходы выбранной фигуры плюс действия мячом, если он у неё. */
  const forSelected = useMemo(() => {
    if (!selected) return [];
    return moves.filter((m) => {
      if (m.kind === 'move' || m.kind === 'tackle') return m.piece === selected;
      // Пас и удар принадлежат владельцу мяча — выбрать его и есть способ
      // добраться до этих ходов.
      return state.ballOwner === selected;
    });
  }, [moves, selected, state.ballOwner]);

  /**
   * Что произойдёт по нажатию на клетку.
   *
   * Порядок важен: пустая клетка ворот годится И под удар, И под ведение, а
   * исход у них одинаковый — гол. Удар берётся первым просто потому, что он
   * работает с любой дистанции, а ведение только с соседней.
   */
  const moveForSquare = (square: Square): Move | null => {
    const shot = forSelected.find((m) => m.kind === 'shot' && sameSquare(m.to, square));
    if (shot) return shot;
    const pass = forSelected.find((m) => m.kind === 'pass' && sameSquare(m.to, square));
    if (pass) return pass;
    const step = forSelected.find((m) => m.kind === 'move' && sameSquare(m.to, square));
    return step ?? null;
  };

  const tackle = forSelected.find((m) => m.kind === 'tackle') ?? null;

  const play = (move: Move) => {
    const next = applyMove(state, move);
    if (next === state) { hapticError(); return; }
    setSelected(null);
    setState(next);
    if (next.lastEvent?.kind === 'goal') hapticImpact('heavy');
    else hapticImpact('light');
  };

  const tapSquare = (square: Square) => {
    if (state.finished) return;
    const move = moveForSquare(square);
    if (move) { play(move); return; }

    // Не ход — значит выбор фигуры. Своей: чужой ходить нельзя, и позволить
    // её «выбрать» значило бы показать подсветку, по которой ничего не нажать.
    const piece = pieceAt(state, square);
    if (piece && piece.side === state.turn) {
      hapticImpact('light');
      setSelected(piece.id === selected ? null : piece.id);
      return;
    }
    setSelected(null);
  };

  const restart = () => {
    hapticImpact('light');
    setSelected(null);
    setState(initialState('home'));
  };

  const champion = winner(state);

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('chess.title')}</h1>
        <span className="ds-display text-white text-lg font-black tabular-nums">
          <span className={SIDE_STYLE.home.text}>{state.score.home}</span>
          <span className="text-brand-muted px-1">:</span>
          <span className={SIDE_STYLE.away.text}>{state.score.away}</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
        {/* Чей ход — или кто выиграл. Одна строка на оба состояния: это ответ
            на один и тот же вопрос «что сейчас происходит». */}
        <div className="flex items-center gap-2">
          {champion ? (
            <p className="ds-display text-white text-sm font-bold">
              {t('chess.won', { side: t(`chess.side_${champion}`) })}
            </p>
          ) : (
            <>
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${SIDE_STYLE[state.turn].dot}`} />
              <p className="text-white text-sm">
                {t('chess.turn', { side: t(`chess.side_${state.turn}`) })}
              </p>
            </>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={restart}
            className="text-brand-muted hover:text-white transition-colors"
            aria-label={t('chess.new_match')}
          >
            <IconRefresh size={18} stroke={2} />
          </button>
        </div>

        <Board
          state={state}
          selected={selected}
          moveForSquare={moveForSquare}
          onTap={tapSquare}
        />

        {/* Отбор — единственное действие, у которого нет своей клетки: он
            происходит там же, где фигура и стоит. Поэтому кнопка, а не тап. */}
        {tackle && !state.finished && (
          <Button fullWidth size="sm" variant="secondary" onClick={() => play(tackle)}>
            {t('chess.tackle')}
          </Button>
        )}

        {/* Что случилось последним ходом. Перехват от паса по одной новой
            позиции мяча не отличить, а игроку эта разница важнее всего. */}
        {state.lastEvent && (
          <p className="text-brand-muted text-xs">
            {eventText(state, t)}
          </p>
        )}

        {state.finished && (
          <Button fullWidth size="sm" onClick={restart}>{t('chess.new_match')}</Button>
        )}

        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-1">
          <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
            {t('chess.rules_title')}
          </p>
          <p className="text-brand-muted text-[10.5px]">{t('chess.rules', { goals: WIN_GOALS })}</p>
          <div className="pt-1 space-y-0.5">
            {(['gk', 'def', 'mid', 'fwd'] as Line[]).map((line) => (
              <p key={line} className="text-brand-muted text-[10.5px]">
                <span className="text-white">{t(`chess.line_${line}`)}</span>
                {' — '}
                {t(`chess.line_${line}_move`)}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Подпись к последнему событию. Имя фигуры — её линия, не «фигура №3». */
function eventText(state: ChessState, t: TFunction): string {
  const event = state.lastEvent;
  if (!event) return '';
  const who = (id: string) => {
    const piece = pieceById(state, id);
    return piece ? t(`chess.line_${piece.line}`) : '';
  };
  switch (event.kind) {
    case 'goal':     return t('chess.event_goal', { side: t(`chess.side_${event.side}`) });
    case 'save':     return t('chess.event_save', { who: who(event.by) });
    case 'block':    return t('chess.event_block', { who: who(event.by) });
    case 'intercept':return t('chess.event_intercept', { who: who(event.by) });
    case 'pass':     return t('chess.event_pass', { who: who(event.to) });
    case 'tackle':   return t('chess.event_tackle', { who: who(event.by) });
    case 'dribble':  return t('chess.event_dribble');
    case 'move':     return t('chess.event_move');
  }
}

interface BoardProps {
  state: ChessState;
  selected: string | null;
  moveForSquare(square: Square): Move | null;
  onTap(square: Square): void;
}

function Board({ state, selected, moveForSquare, onTap }: BoardProps) {
  const { t } = useTranslation();
  const rows = Array.from({ length: BOARD_H }, (_, y) => y);
  const cols = Array.from({ length: BOARD_W }, (_, x) => x);

  return (
    // Поле держит пропорцию 5:7 и не растекается: клетка обязана оставаться
    // квадратной, иначе диагональ перестаёт читаться как диагональ.
    <div
      className="mx-auto w-full max-w-[22rem] grid gap-0.5 rounded-2xl overflow-hidden border border-brand-border"
      style={{ gridTemplateColumns: `repeat(${BOARD_W}, minmax(0, 1fr))` }}
    >
      {rows.map((y) => cols.map((x) => {
        const square = { x, y };
        const piece = pieceAt(state, square);
        const move = moveForSquare(square);
        const isSelected = piece !== null && piece.id === selected;
        const hasBall = piece !== null && piece.id === state.ballOwner;
        const homeGoal = isGoalSquare(square, ownGoalRow('home'));
        const awayGoal = isGoalSquare(square, ownGoalRow('away'));

        return (
          <button
            key={`${x}-${y}`}
            type="button"
            onClick={() => onTap(square)}
            aria-label={squareLabel(square, piece, t)}
            className={[
              'relative aspect-square flex items-center justify-center transition-colors',
              // Шахматная раскладка, приглушённая: поле, а не доска для игры в
              // шашки — контраст между клетками должен быть слабее, чем между
              // фигурами и клетками.
              (x + y) % 2 === 0 ? 'bg-brand-surface' : 'bg-brand-surface/60',
              homeGoal ? 'ring-1 ring-inset ring-sky-400/40' : '',
              awayGoal ? 'ring-1 ring-inset ring-rose-400/40' : '',
              isSelected ? 'ring-2 ring-inset ring-brand-accent' : '',
            ].join(' ')}
          >
            {/* Куда можно пойти. Точка для пустой клетки, кольцо — для занятой:
                во второй мяч ПРИЛЕТИТ, а фигура останется на месте, и рисовать
                это одинаково значило бы обещать перемещение. */}
            {move && !piece && (
              <span className="absolute w-2 h-2 rounded-full bg-brand-accent/70" />
            )}
            {move && piece && (
              <span className="absolute inset-1 rounded-full ring-2 ring-brand-accent/70" />
            )}

            {piece && (
              <span
                className={[
                  'relative w-[78%] h-[78%] rounded-full border flex items-center justify-center',
                  SIDE_STYLE[piece.side].chip,
                ].join(' ')}
              >
                <span className={`ds-display text-[9px] font-black ${SIDE_STYLE[piece.side].text}`}>
                  {t(`chess.line_${piece.line}_short`)}
                </span>
                {/* Мяч — точка на фигуре, а не отдельная клетка: он всегда у
                    кого-то, ничейного мяча в этой игре нет. */}
                {hasBall && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-white border border-brand-bg" />
                )}
              </span>
            )}
          </button>
        );
      }))}
    </div>
  );
}

/**
 * Подпись клетки для скринридера.
 *
 * Доска из 35 одинаковых кнопок без подписей — это 35 кнопок «кнопка». Здесь
 * координата плюс то, что на клетке стоит.
 */
function squareLabel(square: Square, piece: Piece | null, t: TFunction): string {
  const cell = `${String.fromCharCode(65 + square.x)}${BOARD_H - square.y}`;
  if (!piece) return cell;
  return `${cell}, ${t(`chess.side_${piece.side}`)}, ${t(`chess.line_${piece.line}`)}`;
}
