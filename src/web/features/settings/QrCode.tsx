import qrcode from 'qrcode-generator';

/** Quiet zone around the code, in modules. Scanners need at least four. */
const QUIET_ZONE = 4;
/** Error correction level M recovers about 15% of the code, enough for a screen at an angle. */
const CORRECTION_LEVEL = 'M';

interface QrCodeProps {
  text: string;
  /** What the code opens, for screen readers. */
  label: string;
  className?: string;
}

/**
 * A QR code drawn as one SVG path. Always dark on light, in both themes: scanners will not read
 * a light-on-dark code.
 */
export function QrCode({ text, label, className }: QrCodeProps) {
  const code = qrcode(0, CORRECTION_LEVEL);
  code.addData(text);
  code.make();

  const modules = code.getModuleCount();
  const squares: string[] = [];
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (code.isDark(row, column)) squares.push(`M${column} ${row}h1v1h-1z`);
    }
  }
  const extent = modules + QUIET_ZONE * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={extent} height={extent} fill="#fff" />
      <path d={squares.join('')} fill="#000" />
    </svg>
  );
}
