import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const DEFAULT_DB_PATH = process.env.NOTE_DB_PATH || 'data/note-stats.db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS article_stats (
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  article_url  TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  views        INTEGER NOT NULL DEFAULT 0,
  likes        INTEGER NOT NULL DEFAULT 0,
  comments     INTEGER NOT NULL DEFAULT 0,
  collected_at TEXT,
  PRIMARY KEY (period_start, article_url)
);
CREATE INDEX IF NOT EXISTS idx_article_stats_period ON article_stats (period_start);
`;

export function openDb(dbPath = DEFAULT_DB_PATH) {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// rows: array of [period_start, period_end, article_url, title, views, likes, comments, collected_at]
export function upsertRows(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO article_stats
      (period_start, period_end, article_url, title, views, likes, comments, collected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(period_start, article_url) DO UPDATE SET
      period_end   = excluded.period_end,
      title        = excluded.title,
      views        = excluded.views,
      likes        = excluded.likes,
      comments     = excluded.comments,
      collected_at = excluded.collected_at
  `);

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      stmt.run(
        String(row[0] ?? ''),
        String(row[1] ?? ''),
        String(row[2] ?? ''),
        String(row[3] ?? ''),
        toInt(row[4]),
        toInt(row[5]),
        toInt(row[6]),
        row[7] == null ? null : String(row[7]),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return rows.length;
}

function toInt(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
