import React from 'react';

const fmt = (n) => Number(n ?? 0).toLocaleString('ja-JP');

function Delta({ current, previous }) {
  if (previous == null) {
    return <span className="tile-delta flat">前週比 —</span>;
  }
  const diff = Number(current ?? 0) - Number(previous ?? 0);
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '±';
  const sign = diff > 0 ? '+' : '';
  return (
    <span className={`tile-delta ${cls}`}>
      {arrow} {sign}
      {fmt(diff)} <span style={{ color: 'var(--text-muted)' }}>前週比</span>
    </span>
  );
}

const METRICS = [
  { key: 'views', label: '閲覧数' },
  { key: 'likes', label: 'スキ' },
  { key: 'comments', label: 'コメント' },
  { key: 'articles', label: '記事数' },
];

export default function StatTiles({ latest, previous }) {
  if (!latest) return null;
  return (
    <div className="tiles">
      {METRICS.map((m) => (
        <div className="tile" key={m.key}>
          <div className="tile-label">{m.label}</div>
          <div className="tile-value">{fmt(latest[m.key])}</div>
          <Delta current={latest[m.key]} previous={previous ? previous[m.key] : null} />
        </div>
      ))}
    </div>
  );
}
