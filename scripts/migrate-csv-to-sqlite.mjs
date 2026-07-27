import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { openDb, upsertRows, DEFAULT_DB_PATH } from './db.mjs';

const DATA_DIR = process.env.NOTE_OUTPUT_DIR || 'data';

function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      record.push(field);
      field = '';
      if (record.length > 1 || record[0] !== '') {
        rows.push(record);
      }
      record = [];
    } else {
      field += char;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    if (record.length > 1 || record[0] !== '') {
      rows.push(record);
    }
  }

  return rows;
}

function main() {
  const dbPath = process.argv[2] || DEFAULT_DB_PATH;
  const db = openDb(dbPath);

  const files = readdirSync(DATA_DIR)
    .filter((name) => /^note-stats-weekly-.*\.csv$/.test(name))
    .sort();

  if (files.length === 0) {
    console.log(`CSV が見つかりませんでした: ${DATA_DIR}`);
    return;
  }

  let total = 0;
  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const parsed = parseCsv(readFileSync(full, 'utf8'));
    if (parsed.length <= 1) {
      console.log(`スキップ (データなし): ${file}`);
      continue;
    }

    const [, ...dataRows] = parsed; // drop header
    const rows = dataRows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]]);
    const n = upsertRows(db, rows);
    total += n;
    console.log(`取り込み: ${file} (${n} 行)`);
  }

  const weeks = db.prepare('SELECT COUNT(DISTINCT period_start) AS c FROM article_stats').get();
  const articles = db.prepare('SELECT COUNT(*) AS c FROM article_stats').get();
  console.log(`\n完了: ${dbPath}`);
  console.log(`  週数: ${weeks.c} / 総レコード: ${articles.c} (取込 ${total} 行)`);
  db.close();
}

main();
