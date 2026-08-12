/**
 * Круговая диаграмма долей на чистом SVG.
 *
 * Библиотеку графиков ради одного круга не тащим: CSP запрещает внешние
 * скрипты, а самим сегментам хватает трюка со stroke-dasharray — каждый
 * сегмент это кольцо, у которого прорисована только его доля окружности,
 * повёрнутая на сумму предыдущих долей.
 */

export interface DonutSegment {
  value: number;
  color: string;
  label: string;
}

interface Props {
  segments: DonutSegment[];
  /** Подпись в центре — обычно отформатированный итог. */
  centerLabel?: string;
  size?: number;
}

export function DonutChart({ segments, centerLabel, size = 132 }: Props) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  const stroke = size * 0.14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Начало — сверху (12 часов): SVG рисует дуги с трёх часов.
  // Смещения считаются заранее и без мутаций: аккумулятор, изменяемый
  // внутри JSX-map, ломает предпосылки React о чистоте рендера.
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
