# L7N H2H Fantasy Lab v5.1.0

NBA H2H Category Fantasy 的決策工作台：**選人 → 補強 → 每週對戰**，在同一個網站完成。
這是依 L7N V4.0.21 重新設計的新版；**Fantasy 計算規則與原版完全一致**（已用原版程式碼逐項比對，見 [docs/TEST-REPORT.md](docs/TEST-REPORT.md)），
原版檔案沒有被修改或覆蓋，新舊版可以並存。

## 三種開啟方式

| 方式 | 步驟 | 需要 |
|---|---|---|
| **A. 雙擊單檔版（最簡單）** | 執行一次 `npm run build`，雙擊 `dist/L7N-Fantasy-Lab-v5.1.0-standalone.html` | Node.js（只在 build 時）；已附建好的檔案時完全不需要 |
| **B. 本機伺服器（建議，支援離線快取）** | Windows 雙擊 `start.bat`；macOS/Linux 執行 `./start.sh`；或 `npm start` → <http://localhost:5173/> | Node.js ≥ 20（或 Python 3） |
| **C. 部署到網路** | 見下方「部署」 | GitHub 帳號即可 |

> 專案**沒有任何執行期套件依賴、不需要 `npm install`**。直接用瀏覽器原生 ES Modules，所以改程式後重新整理就生效。

## 第一次使用

1. 開啟網站 → 它會在背景嘗試同步 2025-26 完整球季資料（與原版相同的公開 CSV 來源）。右上角資料狀態會顯示「上季完整 · N 人」。
2. 如果同步失敗（離線、來源網址變動），畫面會明確顯示橫幅，並保留上次成功的資料；你可以在 ⚙ **控制中心 → 資料中心** 手動 **匯入 CSV**。
3. 按 `/` 搜尋球員（不分大小寫與重音，`wemby`、`jokic`、`LAL`、Yahoo 名次都可）→ 加入我的球隊 → 看「分類強弱」與 Candidate Fit。
4. 到 **Weekly H2H** 輸入對手 roster，看逐項預測與策略。

### CSV 欄位（匯入 / 遠端同步）
必要：`player`（或 `name`）、`gp`、`pts`。建議：`team, min, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, stl, blk, tov`，可選 `dd, td, pos, fg_pct, ft_pct, fg3_pct`。
同時支援「球季總計」與「每場平均」兩種格式（自動偵測；每場平均的 `mpg` / `min` 視為每場分鐘）。缺值不會被當成 0。

## 功能（六個頁籤）

- **① 選人 / 我的球隊**：Team Pulse、13 項分類強弱（50＝中性）、補強建議、我的球隊個人數據與本週場次、**What-if 模擬台**（加入／移除最多各 4 人，顯示本週數據、分類強弱與 H2H 勝負的前後變化，不改動正式 roster）、**Candidate Fit**（Base/Team Fit、可排序、暫標「已被選走」、直接加入球隊）。
- **② Weekly H2H**：賽週切換、雙方 roster 與每人場次（可手動調整、一鍵還原）、逐項預測表（含差距與「接近」提示）、H2H 項目勾選、主要壓力／最接近翻盤／可以守住。
- **③ NBA 賽程**：30 隊 × 25 週熱度圖、標示我的球員所在球隊、季中交易的球隊覆寫。
- **④ 球員資料**：整個球員池搜尋／排序、球員詳細頁（數據、各分類 Z 分數、資料來源與狀態、手動覆寫球隊）。
- **⑤ Rookie Hub**：2026 選秀 60 人；NCAA 原始資料、NBA Projection（模型估算，明確標示）、NBA 實績三者分開；沒有查證資料就顯示「Metadata only」，不編造。
- **⑥ Yahoo 排名**：Top 200 外部參考（不影響引擎）、**我的選人順位**（拖曳排序，放開才保存一次；也可用 ↑↓ 或 Alt+↑/↓）、無法對應的名單明確列出。
- **控制中心 ⚙**：多聯盟（新增／複製／重新命名／刪除／切換）、設定匯出匯入、分享連結、資料中心（三種資料基準各自獨立）、模型設定、權重、外觀與隱私。

### 球員照片（NBA 官方大頭照）
只用 **NBA 球員 ID**（`player_id`，來自資料管線的逐場資料與球員主檔）組出 `cdn.nba.com` 圖片網址：小圖 260×190 顯示在名字旁，滑鼠移上去／鍵盤聚焦會浮出 1040×760 的放大預覽；手機點一下放大，再點一下、點空白處或按 Esc 關閉。預覽是固定位置的浮層，**不會改變表格列高、不會重排、不會讓捲動位置跳動**。
沒有驗證過 ID 的球員（例如舊版 CSV、尚未出現在球員主檔的新秀）、或圖片載入失敗時，一律顯示隊色首字母頭像，**絕不猜 ID、不用姓名搜尋、不顯示別人的臉**。已不再使用 Wikipedia。
圖片由你的瀏覽器直接從 NBA CDN 載入（不下載、不鏡像進專案；只送出球員 ID，不送姓名）。**公開或商業使用前請先確認 NBA 圖片與商標條款。** 可在控制中心關閉。

### 資料管線與新鮮度
`pipeline/` 是獨立的資料產生流程：從 NBA 官方統計端點抓逐場資料，產生 **本季至今 / 每位球員最近 10 場 / 近 30 天 / 上季完整** 四份資料與 **球員主檔**，全部驗證通過才發佈，失敗就保留上一份有效資料。網站在 ⚙ 控制中心 →「L7N 資料管線」填入資料網址即可使用，並顯示版本、涵蓋日期、最後一場比賽日、過期/警告與最近一次更新是否失敗。完整說明與設定步驟：[docs/DATA-PIPELINE.md](docs/DATA-PIPELINE.md)。
**這條管線尚未在真實 GitHub Actions / 真實 NBA 端點上跑過**（見測試報告的「未驗證」）；未填網址前，網站行為與之前相同。

### 複製選人順位到其他聯盟
Yahoo 排名頁的「我的選人順位」面板 →「複製順位到其他聯盟…」：可選「從其他聯盟複製到目前聯盟」或「把目前順位複製到其他聯盟（可多選）」，方式為「合併」（保留目標原順序、只接上它沒有的球員）或「覆蓋」，確認前會顯示每個聯盟複製前後的人數，操作前自動備份。

## 資料與隱私
所有設定與資料只存在你的瀏覽器（localStorage，命名空間 `l7nlab.v1.*`），沒有帳號、沒有自架後端。
首次開啟時，如果同一個網站來源下找得到原版的 `l7n_h2h_leagues_v1` / `fb_*` 資料，會**唯讀複製**成新格式（並留一份備份），**不會改寫或刪除原版的任何 key**。

## 測試

```bash
npm test                 # 82 個 Node 測試（引擎、資料管線、遷移、儲存、與原版逐項比對）。不需安裝任何套件
pip install -r e2e/requirements.txt && playwright install chromium
python e2e/run.py                      # 28 項真實瀏覽器驗收（http；會用合成來源跑一次完整資料管線）
python e2e/run.py --dir dist           # 對 build 產物
python e2e/run.py --dir dist --file    # 對單檔版（file://）
```
原版比對測試需要原版 `index.html`：放在 `../original/index.html`，或設定 `L7N_ORIGINAL_HTML`；找不到時會標示 skipped。
測試用的假資料（`tests/fixtures/synthetic-*.csv`）是**合成資料，不是真實 NBA 數據**。

## 部署

- **GitHub Pages**：把這個資料夾推到新 repo 的 `main`，Settings → Pages → Source 選 **GitHub Actions**；內附 `.github/workflows/pages.yml` 會執行測試、build 並發佈 `dist/`。（此 workflow 作者尚未實際執行過。）
- **任何靜態主機**（Netlify / Cloudflare Pages / 自己的 Nginx）：`npm run build`，上傳 `dist/` 整個資料夾。
- **只要一個檔案**：`dist/L7N-Fantasy-Lab-v5.1.0-standalone.html` 可直接寄給別人雙擊使用（資料同步仍需要網路）。

⚠ 若新版與原版部署在**同一個網域來源**（例如都在 `你的帳號.github.io` 底下），瀏覽器的 localStorage 是共用的。新版使用獨立的 key 命名空間，不會干擾原版。

## 專案結構

```
index.html · sw.js · manifest.webmanifest
src/engine/     純函式：schema(規則常數) · model(參考池/Z/Fit) · weekly(場次/總量/H2H) · whatif · rookie · search
src/data/       csv 解析 · universe(球員池+球員主檔) · repository(四種資料基準、原子寫入、管線同步) · nba-image/headshots · static/(賽程、Yahoo、新秀、球隊…)
pipeline/       資料產生管線（nba-client · normalize · aggregate · registry · validate · publish · build）· fixtures/ · cli.mjs
src/state/      storage · profiles(schema 遷移、匯入匯出、分享連結) · app(控制器、memo)
src/features/   draft · weekly · schedule · players · rookies · yahoo · drawer(控制中心)
src/components/ avatar · badges · statcells · quickadd · dialog · toast
styles/app.css  設計系統 · scripts/(serve, build) · tests/ · e2e/ · docs/
```
更多設計說明見 [docs/ANALYSIS.md](docs/ANALYSIS.md)。
