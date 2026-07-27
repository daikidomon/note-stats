# note-stats

note のアクセス状況ページから、週次の記事別スタッツを取得し、CSV と SQLite に保存します。
取得したデータは React 製のダッシュボード（`dashboard/`）で閲覧できます。

## 取得する項目

- 記事 URL
- タイトル
- 閲覧数
- スキ数
- コメント数
- 対象週の開始日/終了日
- 取得日時

## 初期設定

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

`.env` に note のログイン情報を入れます。`.env` と `.auth/` は Git 管理しません。

```bash
NOTE_EMAIL=your-email@example.com
NOTE_PASSWORD=your-password
NOTE_TARGET_WEEK=previous
SLACK_WEBHOOK_URL=
```

Slack 通知を使う場合は、`.env` に `SLACK_WEBHOOK_URL` を設定します。取得成功後に、対象期間・記事数・合計値・前週比・ダッシュボード URL・記事別スタッツ・CSV 保存先を通知します。記事別スタッツは Slack メッセージ上で確認できるよう、閲覧数順に最大20件まで表示し、各記事にも前週比と記事 URL（リンク）を表示します。

Slack に載せるダッシュボードのリンクは `DASHBOARD_URL`（未設定時は `http://100.109.191.75:8080`）で変更できます。

## 手動実行

```bash
npm run collect
```

CSV は `data/note-stats-weekly-YYYY-MM-DD_to_YYYY-MM-DD.csv` に保存され、同時に SQLite (`data/note-stats.db`) にも upsert されます。

## データストア（SQLite）

取得データは `data/note-stats.db` の `article_stats` テーブルに保存されます（主キー `(period_start, article_url)`）。
CSV は履歴として残り、SQLite はダッシュボードやクエリ用の参照元です。

既存の CSV から SQLite を（再）構築するには次を実行します。

```bash
npm run migrate
```

SQLite DB は派生物のため Git 管理しません（`npm run migrate` で CSV から再生成できます）。

## ダッシュボード（React）

`dashboard/`（Vite + React）で週次推移・KPI・記事別ランキングを閲覧できます。
`server/server.mjs` が SQLite を読む軽量 API と静的配信を兼ね、`0.0.0.0:8080` で待ち受けます。

```bash
npm run dashboard:build   # 依存インストール + 本番ビルド (dashboard/dist)
npm run serve             # http://0.0.0.0:8080 で配信
```

開発時は API サーバ (`npm run serve`) と Vite (`npm run dashboard:dev`, :5173, /api をプロキシ) を並行起動します。

サーバー上では systemd user service `note-dashboard.service` で常駐させ、内部から `http://100.109.191.75:8080` でアクセスします。

- API: `/api/summary`, `/api/weeks`, `/api/week?start=YYYY-MM-DD`
- ポート/ホスト/DB は `DASHBOARD_PORT` / `DASHBOARD_HOST` / `NOTE_DB_PATH` で変更可能

```bash
systemctl --user status note-dashboard.service
journalctl --user -u note-dashboard.service
systemctl --user restart note-dashboard.service   # 再ビルド後に反映
```

## 週次自動実行

以前は `.github/workflows/weekly-note-stats.yml`（GitHub Actions）でも実行していましたが、
MFA/Captcha で自動ログインが失敗するため廃止し、サーバー上の systemd timer に一本化しました。

## systemd timer 例

サーバー上では user-level systemd timer で実行します。現在の設定例は、毎週日曜 00:30 JST に前週分を取得します。

現在のサーバー設定は以下です。

- Timer unit: `/home/ubuntu/.config/systemd/user/note-stats-weekly.timer`
- Service unit: `/home/ubuntu/.config/systemd/user/note-stats-weekly.service`
- 実行日時: 毎週日曜 `00:30:00` JST
- 取得対象: `NOTE_TARGET_WEEK=previous` で前週分
- 出力先: `/home/ubuntu/note-stats/data`
- 認証情報: `/home/ubuntu/note-stats/.env`
- ログイン状態: `/home/ubuntu/note-stats/.auth/note-storage-state.json`
- Slack通知: `.env` の `SLACK_WEBHOOK_URL`

timer の設定は以下です。

```ini
[Timer]
OnCalendar=Sun 00:30:00
Persistent=true
Unit=note-stats-weekly.service
```

service は `.env` を読み込み、保存済みログイン状態を使って Playwright を headless 実行します。

```ini
[Service]
Type=oneshot
EnvironmentFile=-/home/ubuntu/note-stats/.env
WorkingDirectory=/home/ubuntu/note-stats
Environment=NOTE_TARGET_WEEK=previous
Environment=NOTE_OUTPUT_DIR=/home/ubuntu/note-stats/data
Environment=NOTE_STORAGE_STATE=/home/ubuntu/note-stats/.auth/note-storage-state.json
Environment=HEADLESS=true
ExecStart=/home/ubuntu/.nvm/versions/node/v24.18.0/bin/node /home/ubuntu/note-stats/scripts/collect-note-stats.mjs
```

状態確認と手動実行は以下です。

```bash
systemctl --user status note-stats-weekly.timer
systemctl --user list-timers note-stats-weekly.timer --all
journalctl --user -u note-stats-weekly.service
systemctl --user start note-stats-weekly.service
```

ログアウト後も user timer が動くよう、`loginctl enable-linger ubuntu` を設定済みです。
