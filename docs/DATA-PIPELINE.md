# L7N 資料管線（NBA 官方統計 → 驗證 → 版本化發佈）

依 `L7N_DataPipeline_and_NBAHeadshots_Claude_Spec_V1` 實作。**網站本身仍是純靜態**；資料由獨立的產生流程提供，兩者只透過 `manifest.json` 與版本化檔案溝通。
Phase 1 的現況檢查與 schema 對照見 [DATA-PIPELINE-PHASE1.md](DATA-PIPELINE-PHASE1.md)。

```
GitHub Actions (排程 / 手動)                         瀏覽器 (GitHub Pages，純靜態)
  └─ pipeline/cli.mjs                                   └─ 資料中心填入「資料網址」
       1. 抓 NBA 逐場資料 + 球季總計 + 球員清單            2. 讀 manifest.json（必須 validation=passed）
       2. 標準化 → 彙總 → 球員主檔                        3. 下載版本資料夾內檔案、核對 SHA-256
       3. ★ 全部驗證 ★ （任何一項關鍵失敗就停止）           4. 全部成功才一起寫入；任何失敗全部還原
       4. 寫 v/<版本>/ → 讀回驗證 → 最後才切換 manifest     5. 顯示來源/涵蓋日期/最後比賽日/過期狀態
  └─ 失敗：不動舊檔，寫 status.json，job 紅燈
```

## 輸出（`data` 分支的 `data/` 資料夾）
| 檔案 | 內容 |
|---|---|
| `manifest.json` | **唯一的指標**：版本、UTC 產生時間、賽季、來源、涵蓋日期、最後比賽日、各檔筆數/不重複球員數/SHA-256、驗證結果與警告 |
| `status.json` | 最近一次嘗試（成功/失敗/原因）與最近一次成功。**失敗時只有它會變** |
| `v/<版本>/season_current.csv` | 本季例行賽，開季至今 |
| `v/<版本>/recent10.csv` | 每位球員**自己**最近 10 場出賽 |
| `v/<版本>/recent30d.csv` | 最後比賽日往前 30 天（含兩端），日期寫在 manifest |
| `v/<版本>/season_previous.csv` | 上一個完整例行賽；**驗證通過後不可變**（之後不會重抓，除非 `--force-previous`） |
| `v/<版本>/player_registry.json` | 球員主檔：NBA ID、名稱、別名、球隊、名單狀態、是否本季/上季出現、**不依賴 GP>0**、只增不減 |

CSV 欄位為 `player_id,player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts,dd,td,fg_pct,ft_pct,fg3_pct`（皆為取樣內**總計**；百分比＝總命中÷總出手，出手為 0 時留空）。
這是舊解析器欄位名的超集，所以舊 CSV 與新 CSV 都能匯入。

## 在本機執行
```bash
npm run data:fixture      # 產生合成的 NBA 格式測試來源（假資料，ID 為 9xxxxx）
npm run data:demo         # 用它跑完整管線 → .tmp/data/（manifest.json, status.json, v/…）
node pipeline/cli.mjs --season 2026 --out data --check-headshots     # 真的連 NBA（可能被擋，見下）
```
選項：`--season 2026`（= 2026-27）· `--fixture <json>`（離線來源）· `--force-previous` · `--allow-no-crosscheck`（球季總計端點不可用時仍發佈，並記警告）· `--check-headshots`（抽樣檢查 NBA CDN 圖片可達性）· `--now <ISO>`。結束碼：0 成功/無變更，1 失敗。

## 在 GitHub 上啟用
1. 把專案推到你自己的 repo（**資料放在你控制的 repo**，不再依賴第三方 `rx-src/nba-analysis`）。
2. Actions 內的 **Update L7N datasets** 會：每天 09:30 UTC 自動執行，也可 *Run workflow* 手動執行（可指定賽季、是否重抓上季）。第一次會自動建立 `data` 分支。
3. 成功後資料網址為 `https://raw.githubusercontent.com/<帳號>/<repo>/data/data/`（`raw.githubusercontent.com` 會送出 CORS 標頭，瀏覽器可直接讀）。
4. 到網站 ⚙ 控制中心 →「L7N 資料管線」貼上這個網址 → **測試並同步**。**在這一步成功之前，網站仍使用原本的遠端 CSV，行為不變。**
5. 一旦同步成功，之後開啟網站會優先使用管線資料；舊來源只在「從未成功載入過管線資料」時才會使用。

## 驗證（任何「關鍵」失敗＝不發佈，舊檔原封不動）
| 檢查 ID | 內容 |
|---|---|
| `schema:*` | 必要欄位齊全、數字可解析且非負、`player_id` 為正整數 |
| `unique-ids:*` | 同一檔案內 `player_id` 不可重複（彙總時依 ID 分組；輸出若重複視為錯誤，不做靜默合併） |
| 來源列檢查（標準化階段） | 非數字、負數、命中>出手、缺 ID/日期、**同球員同場次的衝突重複列** → 整批拒絕；完全相同的重複列會去重並計數 |
| `no-future-games` | 不可有晚於今天的比賽 |
| `coverage:previous/current/registry` | 上季 ≥400 人且 30 隊；本季（累積 ≥30 隊場後）≥150 人、≥28 隊；主檔 ≥450 人。另附「現役但本期間沒比賽」的名單與原因說明 |
| `recent10` | 以**獨立的第二份實作**重算每位球員自己的最近 10 場，逐位比對；且任何人 GP ≤ 10 |
| `recent30d` | 重算 30 天視窗並比對，`date_from/date_to` 與 manifest 一致 |
| `percentages:*` | 每列 FG%/FT%/3P% 皆等於總命中÷總出手（容差 1e-6） |
| `cross-check:*` / `sample-players:*` | 與 NBA「球季總計」端點逐位比對 GP、PTS、REB、AST、STL、BLK、TOV、FGM/FGA、FTM/FTA、3PM/3PA（端點若提供 DD2/TD3 也比對）；整體一致率 ≥97%；樣本球員（Haliburton、Jokić、SGA、Wembanyama，有出賽者）必須 100% 一致 |
| `freshness` / `season-start` | 賽季進行中最後一場比賽超過 10 天 → 失敗（>4 天只警告）；賽季尚未開打時 current 資料集允許為空，但開季日 +3 天後仍沒有任何比賽 → 失敗 |
| `registry:*` | 每個資料集內的球員 ID 都在主檔；主檔不得比上一份少人；ID 唯一 |
| `no-regression` | 同一賽季內，本季球員數不得少於上一份已發佈版本 |

發佈順序：暫存資料夾 → 讀回比對 SHA-256 → `rename` 成 `v/<版本>/` → **最後**以「寫暫存檔 + rename」切換 `manifest.json`。更新中途任何一步當機，舊 manifest 與舊檔案都仍然有效（有測試）。預設保留最近 6 個版本。

## 失敗行為
| 情況 | 結果 |
|---|---|
| NBA 擋掉雲端 IP（HTTP 403） | **不重試**（避免加重封鎖），`kind=blocked`；status.json 記錄、job 紅燈；舊資料繼續服務 |
| 429 / 5xx / 逾時 / 網路錯誤 | 最多重試 3 次，指數退避（2s、6s、18s + 抖動）；仍失敗則同上 |
| 回應格式改變（缺欄位、非 JSON） | `kind=malformed`，不發佈 |
| 驗證失敗 | `kind=validation`，訊息列出前 3 項失敗 |
| 資料完全沒變 | `unchanged`，不產生新版本 |
| 前端抓不到 / 版本不通過驗證 / 校驗碼不符 / 寫入空間不足 | 整批拒絕或全部還原；畫面顯示原因並沿用上次有效資料 |

## 備援（NBA 持續擋 GitHub 雲端 IP 時）
1. **手動 CSV**：用任何你信任的來源（例如 NBA.com Stats 的表格匯出）整理成上述欄位（`player_id` 可省略；至少 `player, gp, pts` + 命中/出手數），到 ⚙ → 資料中心 → 對應資料基準 **匯入 CSV**。匯入的資料會被標為「手動匯入」，不會被背景同步覆蓋。
2. **本機跑管線**：在自己的電腦（住宅 IP 通常不被擋）執行 `node pipeline/cli.mjs --season 2026 --out data --check-headshots`，把 `data/` 推到 `data` 分支（或任何靜態主機）。
3. 若需要高可用度：評估付費授權來源（如 SportsDataIO / Sportradar）。**我沒有查證它們目前的價格與授權條款**，請實際比較後再決定；只需新增一個與 `nba-client.mjs` 同介面（`gameLog / dashTotals / allPlayers`）的 adapter。

## 限制與提醒
- `stats.nba.com` 沒有公開 SLA，屬非官方端點；這不是授權資料源。本專案不保證其可用性。
- NBA 官方圖片（`cdn.nba.com`）可以連結顯示，但**可能不等於可公開／商業再散布**；本專案不下載、不鏡像圖片。若網站要公開或商用，請先確認圖片與商標條款。
- 逐場資料的 `GP` 以「有成績列的比賽」計。若 NBA 對 0 分鐘出場的計法不同，球季總計端點比對會報不一致（有警示，不會悄悄通過）。
- 門檻（球員數、隊數、過期天數）與賽季日期（預設 10/15 開季、4/20 結束）是我的假設，請在第一次真實執行後調整（`pipeline/src/validate.mjs` 的 `DEFAULT_THRESHOLDS`、`build.mjs` 的選項）。
