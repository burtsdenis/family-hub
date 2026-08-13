/**
 * Donut chart of shares in pure SVG.
 *
 * No chart library for the sake of one circle: CSP forbids external
 * scripts, and the segments only need the stroke-dasharray trick — each
 * segment is a ring with only its share of the circumference drawn,
 * rotated by the sum of the preceding shares.
 */

export interface DonutSegment {
  value: number;
  color: string;
  label: string;
}

interface Props {
  segments: DonutSegment[];
  /** Center label — usually the formatted total. */
  centerLabel?: string;
  size?: number;
}

export function DonutChart({ segments, centerLabel, size = 132 }: Props) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  const stroke = size * 0.14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Start at the top (12 o'clock): SVG draws arcs from 3 o'clock.
  // Offsets are computed up front and without mutation: an accumulator
  // mutated inside a JSX map breaks React's assumptions about render purity.
  const fractions = segments.map((s) => s.value / total);
  const starts = fractions.map(
    (_, i) => -0.25 + fractions.slice(0, i).reduce((sum, f) => sum + f, 0),
  );

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={segments.map((s) => s.label).join(', ')}
    >
      {segments.map((s, i) => {
        const fraction = fractions[i]!;
        const start = starts[i]!;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${fraction * circumference} ${circumference}`}
            strokeDashoffset={-start * circumference}
          >
            <title>
              {s.label} · {Math.round(fraction * 100)}%
            </title>
          </circle>
        );
      })}
      {centerLabel && (
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-[var(--c-text)] font-mono"
          fontSize={size * 0.095}
        >
          {centerLabel}
        </text>
      )}
    </svg>
  );
}
