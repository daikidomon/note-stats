import React, { useState } from 'react';

const W = 720;
const H = 260;
const PAD = { top: 20, right: 20, bottom: 34, left: 52 };

const fmt = (n) => Number(n ?? 0).toLocaleString('ja-JP');
const shortDate = (d) => (d ? d.slice(5).replace('-', '/') : '');

function niceMax(value) {
  if (value <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    if (value <= s * pow) return s * pow;
  }
  return 10 * pow;
}

// weeks: [{ period_start, period_end, views, likes, comments }]
export default function TrendChart({ weeks, metric }) {
  const [hover, setHover] = useState(null);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const points = weeks.map((w) => Number(w[metric] ?? 0));
  const maxY = niceMax(Math.max(1, ...points));

  const x = (i) =>
    PAD.left + (weeks.length <= 1 ? innerW / 2 : (innerW * i) / (weeks.length - 1));
  const y = (v) => PAD.top + innerH - (innerH * v) / maxY;

  const linePath = weeks
    .map((w, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(points[i])}`)
    .join(' ');

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxY * i) / ticks);

  const handleMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let best = Infinity;
    weeks.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setHover(nearest);
  };

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`週次 ${metric} の推移`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines + y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--grid)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* x labels */}
        {weeks.map((w, i) => (
          <text
            key={w.period_start}
            x={x(i)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-muted)"
          >
            {shortDate(w.period_start)}
          </text>
        ))}

        {/* baseline */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--baseline)"
          strokeWidth="1"
        />

        {/* series line */}
        <path d={linePath} fill="none" stroke="var(--series-1)" strokeWidth="2" />

        {/* markers */}
        {weeks.map((w, i) => (
          <circle
            key={w.period_start}
            cx={x(i)}
            cy={y(points[i])}
            r={hover === i ? 5 : 3.5}
            fill="var(--series-1)"
            stroke="var(--surface-1)"
            strokeWidth="2"
          />
        ))}

        {/* direct label on last point */}
        {weeks.length > 0 && (
          <text
            x={x(weeks.length - 1)}
            y={y(points[weeks.length - 1]) - 10}
            textAnchor="end"
            fontSize="12"
            fontWeight="700"
            fill="var(--text-primary)"
          >
            {fmt(points[weeks.length - 1])}
          </text>
        )}

        {/* hover crosshair */}
        {hover != null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={y(0)}
            stroke="var(--baseline)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {hover != null && (
        <div
          className="tooltip"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            top: `${(y(points[hover]) / H) * 100}%`,
          }}
        >
          <div className="tt-period">
            {weeks[hover].period_start} 〜 {weeks[hover].period_end}
          </div>
          <div className="tt-value">
            {fmt(points[hover])} {metric}
          </div>
        </div>
      )}
    </div>
  );
}
