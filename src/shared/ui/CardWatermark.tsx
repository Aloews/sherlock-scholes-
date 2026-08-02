import { clsx } from 'clsx';
import { photoFitClass } from '@/shared/lib/photoFit';

/**
 * The card's own photo, ghosted behind its name — a hint for the explainer
 * that costs no layout space.
 *
 * It used to sit in the bottom-right corner at a negative offset, so the card
 * clipped it and what showed was a cropped sliver. Centred, it reads as part
 * of the card instead of as something falling off the edge, and there is room
 * to make it large enough to actually recognise.
 *
 * Kept as one component because three screens drew it — the two PlayerCard
 * designs and TrainingScreen — and they had already drifted to different
 * sizes and offsets.
 */
export function CardWatermark({ src, category, className }: {
  src: string;
  category: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'absolute inset-0 flex items-center justify-center pointer-events-none select-none',
        className,
      )}
      aria-hidden
    >
      <img
        src={src}
        alt=""
        // Slightly fainter than the old corner treatment: it now sits behind
        // the name rather than beside it, and the name has to stay the most
        // legible thing on the card.
        className={clsx('w-[62%] h-[62%] opacity-[0.11]', photoFitClass(category))}
      />
    </div>
  );
}
