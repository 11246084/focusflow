# AGENTS.md — FocusFlow Agent Entry Index

短版入口索引。詳細規則請依任務類型跳轉至對應文件。

---

## 專案速覽

**FocusFlow**：AI 教學影片問答系統，Phase 1 MVP。
教師上傳影片 → 自動 STT + 分段 → 學生提問 → AI 回答 + 時間戳。

三個服務：
- `backend/` — Node.js/Express REST API（port 4000）
- `frontend/focus-flow/` — React 19 + Vite SPA（port 5173）
- `STT_Whisper/` — Python 離線 AI Pipeline（CLI）

---

## 文件索引

| 文件 | 用途 | 更新頻率 |
|------|------|----------|
| [README.md](README.md) | 安裝、啟動、API 端點、示範帳號 | 低 |
| [CLAUDE.md](CLAUDE.md) | Claude Code 工作規則、規則檔入口 | 低 |
| [PROJECT.md](PROJECT.md) | 專案背景、MVP 範圍、模組概覽 | 低 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 技術架構、資料流、DB 契約、legacy 差異 | 低 |
| [docs/current-status.md](docs/current-status.md) | 目前進度、缺口、下一步 | **高** |
| [docs/decision-log.md](docs/decision-log.md) | 關鍵架構決策記錄 | 低 |
| [backend/docs/](backend/docs/README.md) | Backend 詳細狀態、demo runbook、交接清單 | 中 |

---

## AI Agent 實作前讀取清單

Claude Code、Codex 或其他 AI agent 接手前，先讀本清單，不要只看單一功能文件。

| 文件 / 入口 | 誰需要看 |
|-------------|----------|
| `AGENTS.md` | Codex、所有 AI agent |
| `CLAUDE.md` | Claude Code、Codex 參考既有工作規則 |
| `.claude/rules/api-design.md` | API、後端、前端串接 |
| `.claude/rules/database.md` | 資料庫、RAG、STT、後端 |
| `.claude/rules/testing.md` | 測試、後端、QA/RAG |
| `.claude/rules/security.md` | 安全、登入、LINE、CORS、OAuth |
| `README.md` | 全部角色 |
| `PROJECT.md` | 產品背景、專題範圍 |
| `ARCHITECTURE.md` | 前端、後端、資料庫、RAG、STT |
| `docs/current-status.md` | 全部角色 |
| `docs/decision-log.md` | 架構、後端、資料庫 |
| `backend/docs/current-state.md` | 後端、RAG、LINE、YouTube、資料庫 |
| `backend/docs/phase2-api-contract.md` | 前端、後端、RAG、LINE、Dashboard |
| `backend/docs/openapi.yaml` | 前端、後端、API |
| `backend/docs/handoff-stt-pipeline-integration.md` | 後端、STT、YouTube |
| `database/README.md` | 資料庫、後端、STT |
| `database/docs/db-handoff-current.txt` | 資料庫、RAG、後端 |
| `frontend/focus-flow/README.md` | 前端、後端串接 |

注意：
- `docs/current-status.md` 與 `backend/docs/current-state.md` 比舊會議紀錄更接近目前狀態。
- `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` 僅供歷史參考，不可當成目前資料庫真相。
- `CLAUDE.local.md` 是個人本機偏好，不是團隊共用規範。

---

## 規則索引（`.claude/rules/`）

執行對應任務前，優先閱讀規則檔案：

| 任務類型 | 規則檔案 |
|----------|----------|
| 新增或修改 API 路由、controller、response 格式、錯誤碼 | [`.claude/rules/api-design.md`](.claude/rules/api-design.md) |
| 修改 Mongoose Schema、索引、資料存取邏輯 | [`.claude/rules/database.md`](.claude/rules/database.md) |
| 撰寫或修改測試、測試 harness | [`.claude/rules/testing.md`](.claude/rules/testing.md) |
| 涉及 JWT 驗證、密碼處理、輸入驗證、CORS | [`.claude/rules/security.md`](.claude/rules/security.md) |

---

## Repo Local Skills（`.claude/skills/`）

| Skill | 觸發方式 | 說明 |
|-------|----------|------|
| `github-copy` | 使用者提及 skill 名稱時 | 產出 GitHub Desktop / VS Code 的 commit Summary + Description |
| `docs-maintainer` | 使用者提及 skill 名稱時 | 整理、盤點、去重 repo 文檔結構 |

使用前先讀取對應的 `SKILL.md`（`.claude/skills/<skill>/SKILL.md`）。
