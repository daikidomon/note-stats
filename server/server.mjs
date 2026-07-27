import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { openDb, DEFAULT_DB_PATH } from '../scripts/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dashboard', 'dist');

const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';
const PORT = Number(process.env.DASHBOARD_PORT || 8080);
const DB_PATH = process.env.NOTE_DB_PATH || DEFAULT_DB_PATH;

const db = openDb(DB_PATH);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function getWeeks() {
  return db
    .prepare(
      `SELECT period_start, period_end,
              COUNT(*)        AS articles,
              SUM(views)      AS views,
              SUM(likes)      AS likes,
              SUM(comments)   AS comments
       FROM article_stats
       GROUP BY period_start, period_end
       ORDER BY period_start ASC`,
    )
    .all();
}

function getArticles(periodStart) {
  return db
    .prepare(
      `SELECT article_url, title, views, likes, comments, collected_at
       FROM article_stats
       WHERE period_start = ?
       ORDER BY views DESC, likes DESC`,
    )
    .all(periodStart);
}

function handleApi(req, res, url) {
  if (url.pathname === '/api/weeks') {
    json(res, 200, getWeeks());
    return true;
  }

  if (url.pathname === '/api/week') {
    const start = url.searchParams.get('start');
    if (!start) {
      json(res, 400, { error: 'start query param required' });
      return true;
    }
    json(res, 200, {
      period_start: start,
      articles: getArticles(start),
    });
    return true;
  }

  if (url.pathname === '/api/summary') {
    const weeks = getWeeks();
    const latest = weeks[weeks.length - 1] ?? null;
    const previous = weeks[weeks.length - 2] ?? null;
    json(res, 200, {
      weekCount: weeks.length,
      totalRecords: db.prepare('SELECT COUNT(*) AS c FROM article_stats').get().c,
      latest,
      previous,
    });
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  if (!existsSync(DIST_DIR)) {
    json(res, 503, {
      error: 'dashboard がビルドされていません。`npm run dashboard:build` を実行してください。',
    });
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') {
    pathname = '/index.html';
  }

  let filePath = path.join(DIST_DIR, pathname);
  // Prevent path traversal.
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html'); // SPA fallback
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      if (!handleApi(req, res, url)) {
        json(res, 404, { error: 'unknown endpoint' });
      }
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`note-stats dashboard: http://${HOST}:${PORT}  (db=${DB_PATH})`);
});
