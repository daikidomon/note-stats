import React, { useMemo, useState } from 'react';

const fmt = (n) => Number(n ?? 0).toLocaleString('ja-JP');

const COLUMNS = [
  { key: 'views', label: '閲覧数' },
  { key: 'likes', label: 'スキ' },
  { key: 'comments', label: 'コメント' },
];

export default function ArticleTable({ articles }) {
  const [sort, setSort] = useState('views');

  const rows = useMemo(
    () => [...articles].sort((a, b) => Number(b[sort] ?? 0) - Number(a[sort] ?? 0)),
    [articles, sort],
  );

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>タイトル</th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className="num"
                style={{ cursor: 'pointer', color: sort === c.key ? 'var(--series-1)' : undefined }}
                onClick={() => setSort(c.key)}
                aria-sort={sort === c.key ? 'descending' : 'none'}
                title="クリックで並び替え"
              >
                {c.label} {sort === c.key ? '▾' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={a.article_url || a.title}>
              <td className="rank">{i + 1}</td>
              <td>
                {a.article_url ? (
                  <a
                    className="article-link"
                    href={a.article_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {a.title || a.article_url}
                  </a>
                ) : (
                  a.title
                )}
              </td>
              <td className="num">{fmt(a.views)}</td>
              <td className="num">{fmt(a.likes)}</td>
              <td className="num">{fmt(a.comments)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
