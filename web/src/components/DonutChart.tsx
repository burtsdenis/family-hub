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
      {centerLabel &&
        (() => {
          /*
            The label must stay inside the hole: "RSD 129,510.28" is
            wider than the inner circle and used to lie across the ring.
            A spaced label (code + amount) splits into two lines, and
            both shrink to the hole if a monster amount still demands it.
            Mono glyphs are ~0.62em wide — close enough for a fit check.
          */
          const hole = size - 2 * stroke;
          const fitted = (text: string, base: number) =>
            Math.min(base, (hole * 0.92) / (Math.max(text.length, 1) * 0.62));
          // formatMoney separates code and amount with a non-breaking
          // space — match any whitespace, not the plain one
          const space = centerLabel.search(/\s/);
          if (space === -1) {
            return (
              <text
                x="50%"
                y="50%"
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-[var(--c-text)] font-mono"
                fontSize={fitted(centerLabel, size * 0.095)}
              >
                {centerLabel}
              </text>
            );
          }
          const unit = centerLabel.slice(0, space);
          const amount = centerLabel.slice(space + 1);
          const amountSize = fitted(amount, size * 0.095);
          return (
            <>
              <text
                x="50%"
                y="50%"
                dy={-amountSize * 0.75}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-[var(--c-text-muted)] font-mono"
                fontSize={fitted(unit, size * 0.07)}
              >
                {unit}
              </text>
              <text
                x="50%"
                y="50%"
                dy={amountSize * 0.5}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-[var(--c-text)] font-mono"
                fontSize={amountSize}
              >
                {amount}
              </text>
            </>
          );
        })()}
    </svg>
  );
}
