# RM 隨行助手 — 後台管理功能開發計畫

## 專案現況

- **部署方式**：GitHub 存檔 → Cloudflare Pages 自動部署
- **網址**：https://rm.deepmystic.net/
- **程式架構**：單一 `index.html`（1560 行），資料存於 LocalStorage
- **版本**：v4.5

---

## 目標：加入後台管理員功能

讓管理者能分析所有用戶的行銷動態、拜訪頻率、拜訪紀錄。

---

## 用戶身份方案：方案 A（輸入姓名）

- 第一次開啟 app，彈出視窗請用戶輸入姓名
- 姓名存入 LocalStorage，之後不再詢問
- 用戶可以自己修改姓名
- 每次送出紀錄時，自動帶上姓名上傳後端
- 後端做 trim() 避免空白字元造成重複用戶

---

## 技術架構

```
GitHub
  ├── index.html        ← 現有前端（加入用戶名 + 上傳邏輯）
  ├── admin.html        ← 新增後台頁面（管理者儀表板）
  └── worker/
        └── index.js    ← Cloudflare Worker API

Cloudflare
  ├── Pages  → 部署靜態頁面
  ├── Workers → 處理 API 請求
  └── D1      → SQLite 資料庫（免費 5GB）
```

---

## 資料庫設計（D1）

```sql
-- 用戶紀錄表
CREATE TABLE records (
  id          TEXT PRIMARY KEY,
  user_name   TEXT NOT NULL,
  type        TEXT NOT NULL,        -- 'report' | 'meeting' | 'site'
  client_name TEXT,
  rm_group    TEXT,
  owner       TEXT,
  visit_date  TEXT,
  visit_hour  INTEGER,
  purpose     TEXT,                 -- '新户开发' | '旧户维系'
  city        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

---

## 後台儀表板分析維度

| 分析項目 | 說明 |
|----------|------|
| 拜訪頻率 | 每位用戶本週/月拜訪幾次 |
| 客戶覆蓋 | 哪些客戶被拜訪、多久沒拜訪 |
| 活動類型 | 訪談 vs 會議 vs 現場 比例 |
| 時間分佈 | 拜訪集中在哪些時段 |
| 目的分析 | 新戶開發 vs 舊戶維係比例 |

---

## 開發步驟

- [ ] 1. Cloudflare D1 建立資料庫與資料表
- [ ] 2. Cloudflare Worker 建立 API（POST 上傳 / GET 查詢）
- [ ] 3. `index.html` 加入姓名輸入流程
- [ ] 4. `index.html` 的 `finalizeSave()` 加入上傳邏輯
- [ ] 5. 建立 `admin.html` 後台儀表板
- [ ] 6. 後台加入密碼保護
- [ ] 7. 測試 & 部署

---

## 後台進入方式

獨立頁面 `https://rm.deepmystic.net/admin.html`，進入需輸入管理者密碼（hardcode 或存 Worker 環境變數）。
