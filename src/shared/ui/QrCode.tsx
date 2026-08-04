import { useMemo } from 'react';
import { encodeQr, qrPath } from '@/shared/lib/qr';

interface QrCodeProps {
  /** What the camera should read. */
  value: string;
  /** Rendered edge in CSS pixels. */
  size?: number;
  className?: string;
  /** Accessible name — the code itself is invisible to a screen reader. */
  label?: string;
}

/**
 * A QR code as one SVG path.
 *
 * Two things here are not decoration. The white plate: a scanner needs dark
 * modules on a light field, and this app's surfaces are near-black, so drawing
 * the code straight onto them would leave nothing to read. The four-module
 * quiet zone around it: also part of the standard, also unreadable without.
 */
export function QrCode({ value, size = 200, className, label }: QrCodeProps) {
  const { path, span } = useMemo(() => {
    const matrix = encodeQr(value);
    const quiet = 4;
    return { path: qrPath(matrix), span: matrix.size + quiet * 2 };
  }, [value]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      className={className}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={span} height={span} fill="#ffffff" rx={1} />
      <g transform="translate(4 4)" fill="#000000">
        <path d={path} />
      </g>
    </svg>
  );
}
