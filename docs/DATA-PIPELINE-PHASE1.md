# Phase 1 — 現況檢查與 Schema 對照（先於任何程式變更）

依 `L7N_DataPipeline_and_NBAHeadshots_Claude_Spec_V1` Phase 1。以下問題都用 v5.0.0 程式碼實際重現過（腳本輸出附在各項）。

## A. 目前資料流程（v5.0.0）
`遠端 CSV（rx-src/nba-analysis，第三方 repo）` → `recordsFromCsv()` → `repository.commitDataset()`（localStorage）→ `buildUniverse()`（依資料基準組球員池）→ 引擎。
只有「上季完整」會自動同步；「本季至今 / 近 10 場」只能手動匯入 CSV；沒有 manifest、版本、日期涵蓋範圍、最後一場比賽日期、checksum。

## B. 發現的問題（依對「準確性 / 完整性 / 不退化」的影響排序）
| # | 問題 | 證據 | 影響 | 規格對應 |
|---|---|---|---|---|
| **B1** | **窗口資料集（本季至今 / 近 10 場）若沒有 `dd` 欄位，會被套上內建的 2025-26「整季」DD 總數**，再除以窗口 GP | `Karl-Anthony Towns` 10 場資料 → `dd = 56` → DD/G = **5.6**（不可能） | DD 分類 Z 分數錯誤，且不會有任何警告 | Metric semantics |
| **B2** | 兩位不同球員正規化名稱相同時，球員池只剩一位（後者覆蓋前者，無警告） | 2 列同名 → 球員池 1 人 | 球員完整性受損；沒有 ID 無從區分 | Player IDs |
| **B3** | `PLAYER_ID` 在 CSV 解析時被丟棄，全站以名稱為身分 | record 無 `nbaId` | 無法做官方照片、同名區分、改名追蹤 | Player IDs / headshots |
| **B4** | 沒有球員主檔：球員身分依賴「該期間 CSV 有沒有出現」+「上季資料集」+ Yahoo/新秀名單。**新簽約、上季沒打、本期間也沒打的球員會直接不在球員池** | `buildUniverse` 只取 dataset ∪ last ∪ 新秀 ∪ 歷史補充 ∪ Yahoo | 球員完整性 | Registry |
| **B5** | 資料來源是第三方 repo，單一網址、沒有版本與回退；失敗只剩「保留上次」，且無法分辨資料是新是舊 | `DEFAULT_BASELINE_URL` | 準確性無法稽核 | Architecture |
| **B6** | 匯入驗證只檢查筆數（≥20 / ≥400）：不檢查命中率 = 命中/出手、重複 ID、涵蓋隊伍、最近 10 場是否真的 ≤10 場 | `validateRecords()` | 壞資料可發佈 | Validation |
| **B7** | 多份資料集各自獨立寫入：更新途中失敗會出現「本季至今是新的、近 10 場是舊的」的混合版本 | `commitDataset` per basis | 版本不一致 | Validation #9 |
| **B8** | 沒有「近 30 天」資料基準；「近 10 場」的定義未寫明（可能被理解成聯盟日曆日） | `DATA_BASES` 只有 3 種 | 語意不清 | Data products |
| **B9** | 資料狀態只顯示「N 人」與抓取時間，看不到資料涵蓋的日期、最後一場比賽日、是否過期 | `drawer.js` | 使用者無法判斷新鮮度 | Observability |
| **B10** | 球員照片用 Wikipedia 以**姓名**查詢（規格禁止；同名可能對到錯的人） | `headshots.js` | 照片可信度 | Headshots |
| B11 | 百分比欄位優先採用 CSV 內的 `fg_pct` 等，而不是 makes/attempts | `fromTotals` | 若來源給的是逐場平均百分比會語意錯誤。**不改引擎**；改由新管線保證輸出為「總命中 ÷ 總出手」 | Metric semantics |

| **B12** | 歷史補充球員（2024-25 數字，只有 4 人）在「本季至今 / 近期」基準下也會被當成有統計，並進入週預測 | `buildUniverse` 對所有基準套用 | 受傷的球員在本季視窗顯示的是舊球季數字（雖有「歷史」標示） | Zero-GP / no fake current stats |

> B1、B2、B3 是**目前版本就存在的真實缺陷**，與是否導入新管線無關；本次一併修在「資料載入層」，不碰引擎。

## C. 舊 CSV schema → 新標準化 schema 對照
新管線輸出的 CSV 是舊解析器可接受欄位名的**超集**（舊檔照常可用）。

| 新欄位 | 舊解析器別名 | 語意 | 備註 |
|---|---|---|---|
| `player_id` | （無，被丟棄）→ 新增別名 `player_id, nba_id, person_id` | NBA 官方球員 ID（整數） | 傳到 `record.nbaId`；缺少時為 `null`，**絕不猜測** |
| `player` | `player, player_name, name` | 顯示名稱 | 身分以 `player_id` 為準，名稱只是顯示與舊資料相容 |
| `team` | `team, team_abbreviation, tm` | 該取樣內**最近一場**的球隊 | 交易後的球隊 |
| `gp` | `gp, games, games_played` | 取樣內出賽場數（有成績列的比賽） | |
| `min` | `min, minutes` | 取樣內**總**分鐘 | 與舊「球季總計」格式一致 |
| `fgm fga fg3m fg3a ftm fta` | 同名 | 取樣內總計 | |
| `reb ast stl blk tov pts` | 同名 | 取樣內總計 | 引擎仍以 ÷gp 得每場平均 |
| `dd`, `td` | `dd, dd2, double_doubles…` | 取樣內雙十 / 大三元**次數** | 由逐場成績依標準定義計算；**不再套用內建對照表**（見 B1） |
| `fg_pct ft_pct fg3_pct` | `fg_pct, ft_pct, fg3_pct` | 總命中 ÷ 總出手（出手為 0 時留空） | 不是逐場百分比平均 |

### 球員主檔 `player_registry.json`
`{ schema, generatedAt, season, players: [{ id, name, aliases[], team, rosterStatus, current, lastSeason, firstSeason?, lastGameDate, seasonsSeen[] }] }`
- 來源聯集：NBA 球員清單端點 ∪ 本季逐場資料 ∪ 上季逐場資料 ∪ **上一份有效主檔**（只增不減，球員不會因為本次沒資料而消失）。
- **不以 GP>0 為條件**：沒有成績的球員仍在主檔，統計欄位為 null、GP=0。

### `manifest.json`
`{ schema, datasetVersion, generatedAt(UTC), season:{start,display}, previousSeason, source:{name,endpoints[],fetchedAt}, coverage:{current:{dateFrom,dateTo,sourceLastGameDate,seasonStarted}, recent10:{rule}, recent30d:{dateFrom,dateTo}, previous:{…}}, files:{name:{path,rows,uniquePlayers,sha256,bytes}}, registry:{players}, validation:{status:'passed',checks[],warnings[]}, path:'v/<datasetVersion>' }`
前端只在 `validation.status === 'passed'` 時採用。

## D. 資料集語意（寫死並有測試）
- `season_current.csv`：本季例行賽（Regular Season），開季至今。
- `recent10.csv`：**每位球員自己的最近 10 場出賽**（不是聯盟日曆 10 天）。
- `recent30d.csv`：`date_to`（來源最後一場完成比賽日）往前 29 天，含兩端；確切日期寫進 manifest。
- `season_previous.csv`：上一個完整例行賽；驗證通過後**不可變**（之後的更新不會重新產生，除非明確 `--force-previous`）。
- 賽季記法：`--season 2026` = 2026-27（NBA 起始年記法），輸出同時帶顯示字串 `2026-27`。

## E. 發佈策略
1. 全部在暫存資料夾產生 → 驗證 → 寫入 `v/<version>/` → 讀回比對 checksum →
2. **最後**才用「寫暫存檔 + rename」更新 `manifest.json` 指標（原子）。
3. 任何一步失敗：不動 `manifest.json`、不動舊版本；另寫 `status.json`（最近一次嘗試與失敗原因）供前端顯示。
4. 只保留最近 N 個版本（預設 6），永不刪除 manifest 指向的版本。

## F. 邊界（不做）
不改引擎、計分、權重、H2H、六個頁籤、Yahoo 拖曳、候選 Fit、聯盟/localStorage 結構。僅動：資料產生、資料載入、球員主檔 / ID 傳遞、資料新鮮度顯示、照片顯示。
**實作決定（B12）**：歷史補充只用於「上季完整」基準；本季／近 10 場／近 30 天基準下，沒有該期間成績的球員一律顯示「無統計」（GP=0、數值為空），不借用舊球季數字。這是**行為變更**，請知悉。
**實作決定（B2）**：同名但 NBA ID 不同的球員，兩位都以「姓名 (球隊)」區分保留；因此原本只用單純名字存的 roster 項目會顯示「資料中找不到」，需要重新加入。Yahoo 名單中的同名項目因為無法確定是哪一位，不會被自動指定名次。

（使用者另外要求的「複製 Yahoo 選人順位到其他聯盟」是獨立的小功能，只新增動作與一個對話框。）
