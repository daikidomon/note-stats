import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';

const NOTE_ORIGIN = 'https://note.com';
const NOTE_LOGIN_URL = `${NOTE_ORIGIN}/login`;
const NOTE_STATS_URL = `${NOTE_ORIGIN}/sitesettings/stats`;
const NOTE_STATS_API_URL = `${NOTE_ORIGIN}/api/v1/stats/pv`;
const DEFAULT_STORAGE_STATE = '.auth/note-storage-state.json';
const DEFAULT_OUTPUT_DIR = 'data';
const DEFAULT_TIMEZONE = 'Asia/Tokyo';
const DEFAULT_TARGET_WEEK = 'previous';
const CSV_HEADERS = [
  'period_start',
  'period_end',
  'article_url',
  'title',
  'views',
  'likes',
  'comments',
  'collected_at',
];

async function main() {
  loadDotEnv();

  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    printHelp();
    return;
  }

  const loginOnly = args.has('--login-only');
  const dryRun = args.has('--dry-run');
  const timezone = process.env.TZ || process.env.NOTE_TIMEZONE || DEFAULT_TIMEZONE;
  const headless = envBool('HEADLESS', !loginOnly);
  const storageStatePath = process.env.NOTE_STORAGE_STATE || DEFAULT_STORAGE_STATE;
  const targetWeek = process.env.NOTE_TARGET_WEEK || DEFAULT_TARGET_WEEK;
  const email = process.env.NOTE_EMAIL;
  const password = process.env.NOTE_PASSWORD;

  const browser = await chromium.launch({ headless });
  const contextOptions = {
    locale: 'ja-JP',
    timezoneId: timezone,
  };

  if (existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    let authenticated = await canFetchStats(context.request);

    if (!authenticated) {
      await loginToNote(page, {
        email,
        password,
        headless,
      });
      authenticated = await canFetchStats(context.request);
    }

    if (!authenticated) {
      throw new Error('note の認証に失敗しました。メール/パスワード、MFA、Captcha の有無を確認してください。');
    }

    await saveStorageState(context, storageStatePath);

    if (loginOnly) {
      console.log(`ログイン状態を保存しました: ${storageStatePath}`);
      return;
    }

    const stats = await collectWeeklyStats(context.request, targetWeek);
    const rows = buildCsvRows(stats, timezone);

    if (rows.length === 0) {
      throw new Error('取得できた記事別スタッツが 0 件でした。note の画面で対象週のデータを確認してください。');
    }

    const csv = toCsv([CSV_HEADERS, ...rows]);
    const outputFile = resolveOutputFile(stats, timezone);

    if (dryRun) {
      console.log(csv);
      console.error(`dry-run: ${rows.length} rows, output=${outputFile}`);
      return;
    }

    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, csv, 'utf8');

    console.log(`CSV を保存しました: ${outputFile}`);
    console.log(`期間: ${rows[0][0]} - ${rows[0][1]}`);
    console.log(`記事数: ${rows.length}`);
  } finally {
    await browser.close();
  }
}

function printHelp() {
  console.log(`Usage:
  npm run collect
  npm run auth
  node scripts/collect-note-stats.mjs --dry-run

Required for automated login:
  NOTE_EMAIL       note login email or note ID
  NOTE_PASSWORD    note login password

Optional:
  NOTE_TARGET_WEEK   previous | current (default: previous)
  NOTE_OUTPUT_DIR    output directory (default: data)
  NOTE_OUTPUT_FILE   exact CSV output path
  NOTE_STORAGE_STATE Playwright storage state path (default: .auth/note-storage-state.json)
  NOTE_TIMEZONE      timezone for collected_at (default: Asia/Tokyo)
  HEADLESS           true | false`);
}

function loadDotEnv(filePath = '.env') {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSyncSafe(filePath);
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripEnvQuotes(rawValue.trim());
  }
}

function readFileSyncSafe(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

async function canFetchStats(request) {
  try {
    const stats = await fetchStatsPage(request, {
      filter: 'weekly',
      page: 1,
      sort: 'pv',
    });
    return Array.isArray(stats.noteStats);
  } catch {
    return false;
  }
}

async function loginToNote(page, { email, password, headless }) {
  await page.goto(`${NOTE_LOGIN_URL}?redirectPath=%2Fsitesettings%2Fstats`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });

  if (!email || !password) {
    if (headless) {
      throw new Error('NOTE_EMAIL と NOTE_PASSWORD が必要です。手動ログインする場合は npm run auth を使ってください。');
    }

    console.log('ブラウザで note にログインしてください。ログイン後、このターミナルで Enter を押してください。');
    await waitForEnter();
    await page.goto(NOTE_STATS_URL, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    return;
  }

  await page.locator('input[autocomplete="username"], input[placeholder*="mail"], input[type="email"], input[type="text"]').first().fill(email);
  await page.locator('input[autocomplete="current-password"], input[type="password"]').first().fill(password);

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (button) => /ログイン|login/i.test(button.innerText) && !button.disabled,
      ),
    undefined,
    { timeout: 30_000 },
  );

  const loginButton = page.getByRole('button', { name: /ログイン|login/i }).last();
  await loginButton.waitFor({ state: 'visible', timeout: 30_000 });
  await loginButton.click();
  await page
    .waitForURL((url) => !url.href.includes('/login') && !url.href.includes('/mfa_login'), {
      timeout: 60_000,
    })
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

  await page.goto(NOTE_STATS_URL, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });

  const currentUrl = page.url();
  if (currentUrl.includes('/mfa_login')) {
    throw new Error(`MFA 画面に遷移しました。手動ログインが必要です: ${currentUrl}`);
  }
}

async function waitForEnter() {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question('');
  } finally {
    rl.close();
  }
}

async function saveStorageState(context, storageStatePath) {
  await mkdir(path.dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
}

async function collectWeeklyStats(request, targetWeek) {
  if (!['previous', 'current'].includes(targetWeek)) {
    throw new Error(`NOTE_TARGET_WEEK は previous または current を指定してください: ${targetWeek}`);
  }

  const baseParams = {
    filter: 'weekly',
    page: 1,
    sort: 'pv',
  };

  let stats = await fetchStatsPage(request, baseParams);

  if (targetWeek === 'previous') {
    if (!stats.endDate) {
      throw new Error('前週取得に必要な endDate が API 応答にありません。');
    }

    stats = await fetchStatsPage(request, {
      ...baseParams,
      end_date: stats.endDate,
      span: 'prev',
    });
  }

  const firstPage = stats;
  const noteStats = [...(firstPage.noteStats ?? [])];
  let page = 1;

  while (!stats.lastPage) {
    page += 1;
    stats = await fetchStatsPage(request, {
      filter: 'weekly',
      page,
      sort: 'pv',
      start_date: firstPage.startDate,
      end_date: firstPage.endDate,
    });
    noteStats.push(...(stats.noteStats ?? []));

    if (page >= 100) {
      throw new Error('ページ数が 100 を超えたため停止しました。ページネーション条件を確認してください。');
    }
  }

  return {
    ...firstPage,
    noteStats,
  };
}

async function fetchStatsPage(request, params) {
  const response = await request.get(NOTE_STATS_API_URL, {
    params,
    timeout: 60_000,
  });

  const contentType = response.headers()['content-type'] ?? '';
  const body = await response.text();

  if (!response.ok()) {
    throw new Error(`note stats API error: HTTP ${response.status()} ${body.slice(0, 200)}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`note stats API did not return JSON: ${contentType}`);
  }

  const json = JSON.parse(body);
  if (json.error) {
    throw new Error(`note stats API returned error: ${JSON.stringify(json.error)}`);
  }

  const data = normalizeStatsData(json.data ?? json);
  if (!Array.isArray(data.noteStats)) {
    throw new Error(`noteStats が API 応答にありません: ${Object.keys(data).join(', ')}`);
  }

  return data;
}

function normalizeStatsData(data) {
  const noteStats = data.noteStats ?? data.note_stats;

  return {
    startDateStr: data.startDateStr ?? data.start_date_str,
    startDate: data.startDate ?? data.start_date,
    endDateStr: data.endDateStr ?? data.end_date_str,
    endDate: data.endDate ?? data.end_date,
    lastPage: data.lastPage ?? data.last_page ?? false,
    lastCalculateAt: data.lastCalculateAt ?? data.last_calculate_at,
    noteStats: Array.isArray(noteStats) ? noteStats.map(normalizeNoteStat) : noteStats,
  };
}

function normalizeNoteStat(note) {
  return {
    ...note,
    noteUrl: note.noteUrl ?? note.note_url,
    readCount: note.readCount ?? note.read_count,
    likeCount: note.likeCount ?? note.like_count,
    commentCount: note.commentCount ?? note.comment_count,
  };
}

function buildCsvRows(stats, timezone) {
  const periodStart = toDateOnly(stats.startDateStr || stats.startDate, timezone);
  const periodEnd = toDateOnly(stats.endDateStr || stats.endDate, timezone);
  const collectedAt = formatDateTime(new Date(), timezone);

  return [...stats.noteStats]
    .sort((a, b) => numberValue(b.readCount) - numberValue(a.readCount))
    .map((note) => [
      periodStart,
      periodEnd,
      resolveArticleUrl(note),
      note.name ?? note.title ?? '',
      numberValue(note.readCount),
      numberValue(note.likeCount),
      numberValue(note.commentCount),
      collectedAt,
    ]);
}

function resolveArticleUrl(note) {
  const directUrl = firstString(note.url, note.noteUrl, note.shareUrl, note.path);
  if (directUrl) {
    if (directUrl.startsWith('http://') || directUrl.startsWith('https://')) {
      return directUrl;
    }

    if (directUrl.startsWith('/')) {
      return `${NOTE_ORIGIN}${directUrl}`;
    }
  }

  const key = firstString(note.key, note.noteKey);
  const urlname = firstString(
    note.urlname,
    note.user?.urlname,
    note.creator?.urlname,
    note.owner?.urlname,
  );

  if (urlname && key) {
    return `${NOTE_ORIGIN}/${urlname}/n/${key}`;
  }

  return key ? `${NOTE_ORIGIN}/n/${key}` : '';
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function numberValue(value) {
  const number = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function resolveOutputFile(stats, timezone) {
  if (process.env.NOTE_OUTPUT_FILE) {
    return process.env.NOTE_OUTPUT_FILE;
  }

  const outputDir = process.env.NOTE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
  const start = toDateOnly(stats.startDateStr || stats.startDate, timezone) || 'unknown-start';
  const end = toDateOnly(stats.endDateStr || stats.endDate, timezone) || 'unknown-end';
  return path.join(outputDir, `note-stats-weekly-${start}_to_${end}.csv`);
}

function toCsv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toDateOnly(value, timezone) {
  if (!value) {
    return '';
  }

  const text = String(value);
  const isoDate = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) {
    return isoDate;
  }

  const slashDate = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashDate) {
    return [
      slashDate[1],
      slashDate[2].padStart(2, '0'),
      slashDate[3].padStart(2, '0'),
    ].join('-');
  }

  const japaneseDate = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (japaneseDate) {
    return [
      japaneseDate[1],
      japaneseDate[2].padStart(2, '0'),
      japaneseDate[3].padStart(2, '0'),
    ].join('-');
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : formatDate(date, timezone);
}

function formatDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return [
    parts.find((part) => part.type === 'year')?.value,
    parts.find((part) => part.type === 'month')?.value,
    parts.find((part) => part.type === 'day')?.value,
  ].join('-');
}

function formatDateTime(date, timezone) {
  const datePart = formatDate(date, timezone);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const timePart = [
    parts.find((part) => part.type === 'hour')?.value,
    parts.find((part) => part.type === 'minute')?.value,
    parts.find((part) => part.type === 'second')?.value,
  ].join(':');

  return `${datePart}T${timePart}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
