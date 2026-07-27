import React, { useEffect, useMemo, useState } from 'react';
import { fetchWeeks, fetchWeek } from './api.js';
import StatTiles from './components/StatTiles.jsx';
import TrendChart from './components/TrendChart.jsx';
import ArticleTable from './components/ArticleTable.jsx';

const METRICS = [
  { key: 'views', label: '閲覧数' },
  { key: 'likes', label: 'スキ' },
  { key: 'comments', label: 'コメント' },
];

function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'auto',
  );
  useEffect(() => {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);
  const cycle = () => setTheme((t) => (t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'));
  return [theme, cycle];
}

export default function App() {
  const [weeks, setWeeks] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState('');
  const [metric, setMetric] = useState('views');
  const [articles, setArticles] = useState(null);
  const [theme, cycleTheme] = useTheme();

  useEffect(() => {
    fetchWeeks()
      .then((data) => {
        setWeeks(data);
        if (data.length > 0) {
          setSelected(data[data.length - 1].period_start);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setArticles(null);
    fetchWeek(selected)
      .then((data) => setArticles(data.articles))
      .catch((e) => setError(e.message));
  }, [selected]);

  const { latest, previous } = useMemo(() => {
    if (!weeks || weeks.length === 0) return { latest: null, previous: null };
    const idx = weeks.findIndex((w) => w.period_start === selected);
    const i = idx === -1 ? weeks.length - 1 : idx;
    return { latest: weeks[i], previous: i > 0 ? weeks[i - 1] : null };
  }, [weeks, selected]);

  if (error) {
    return (
      <div className="app">
        <div className="state error">読み込みに失敗しました: {error}</div>
      </div>
    );
  }

  if (!weeks) {
    return (
      <div className="app">
        <div className="state">読み込み中…</div>
      </div>
    );
  }

  const themeLabel = theme === 'auto' ? '🖥 自動' : theme === 'light' ? '☀ ライト' : '🌙 ダーク';

  return (
    <div className="app">
      <div className="app-header">
        <h1>note スタッツ ダッシュボード</h1>
        <div className="toolbar">
          <select
            className="control"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="対象週"
          >
            {[...weeks].reverse().map((w) => (
              <option key={w.period_start} value={w.period_start}>
                {w.period_start} 〜 {w.period_end}（{w.articles} 記事）
              </option>
            ))}
          </select>
          <button className="control" onClick={cycleTheme} title="テーマ切替">
            {themeLabel}
          </button>
        </div>
      </div>
      <p className="app-sub">
        週次 {weeks.length} 件 ・ 選択中の週の合計値と前週比、記事別ランキングを表示します。
      </p>

      <StatTiles latest={latest} previous={previous} />

      <div className="card">
        <div className="card-head">
          <h2 className="card-title">週次推移</h2>
          <div className="metric-switch" role="group" aria-label="指標切替">
            {METRICS.map((m) => (
              <button
                key={m.key}
                aria-pressed={metric === m.key}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <TrendChart weeks={weeks} metric={metric} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="card-title">
            記事別ランキング（{selected}
            {latest ? ` 〜 ${latest.period_end}` : ''}）
          </h2>
        </div>
        {articles == null ? (
          <div className="state">読み込み中…</div>
        ) : articles.length === 0 ? (
          <div className="state">この週のデータはありません。</div>
        ) : (
          <ArticleTable articles={articles} />
        )}
      </div>
    </div>
  );
}
