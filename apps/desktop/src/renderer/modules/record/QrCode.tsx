import { useMemo, type ReactElement } from 'react';
import qrcode from 'qrcode-generator';

/**
 * A QR code rendered as inline SVG.
 *
 * Drawn as one `<path>` of module rectangles rather than a canvas, so it stays
 * crisp at any DPI and needs no ref/effect plumbing. Rendered light-on-dark
 * inside its own white quiet zone, because scanners need the quiet margin and
 * the app's dark theme would otherwise eat it.
 */
interface QrCodeProps {
  value: string;
  /** Rendered size in CSS pixels. */
  size?: number;
}

export function QrCode({ value, size = 200 }: QrCodeProps): ReactElement {
  const { path, count } = useMemo(() => {
    // typeNumber 0 = pick the smallest version that fits; 'M' correction
    // tolerates a phone camera at an angle without bloating the module count.
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const modules = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (qr.isDark(row, col)) d += `M${String(col)},${String(row)}h1v1h-1z`;
      }
    }
    return { path: d, count: modules };
  }, [value]);

  // 2 modules of quiet zone on each side (4 is the spec's ideal; 2 scans fine
  // and keeps the code legible at this size).
  const quiet = 2;
  const extent = count + quiet * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(extent)} ${String(extent)}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Pairing QR code — scan with your phone's camera"
      className="rounded-lg bg-white"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <g transform={`translate(${String(quiet)},${String(quiet)})`}>
        <path d={path} fill="#000000" />
      </g>
    </svg>
  );
}
