# Agent Skills

適用於 Claude Code 的 agent skills 集合。

## 安裝

```bash
npx skills add RayChang/agent-skills@<skill-name>
```

安裝後 skill 會放在 `~/.claude/skills/<skill-name>/`，Claude Code 啟動時會自動載入。

## 使用

Skills 可透過兩種方式觸發：

1. **自然語言** — 直接描述需求，Claude 會根據 skill 的描述自動選用。
   - 例：「把這份 PDF 轉成 markdown」→ 自動使用 `markitdown`
   - 例：「幫這個專案建立 KB」→ 自動使用 `kb-wiki`
2. **Slash command** — 輸入 `/<skill-name>` 或 `/<skill-name> <operation>`。
   - 例：`/kb-wiki init`、`/cove`

想確認是否安裝成功，在 Claude Code 中輸入 `/` 查看可用列表，或執行 `/help`。

---

## Skills

### `kb-wiki`

基於 [Andrej Karpathy 的 LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，在專案中建立並維護 LLM 驅動的個人知識庫。

由 LLM 負責撰寫與維護 wiki 內容，人類負責整理來源資料與提問。

**支援操作：**

- `init` — 初始化 KB，建立目錄結構與 schema
- `ingest` — 處理新的來源文件，更新 wiki 頁面
- `query` — 以 wiki 內容回答問題，並將有價值的答案歸檔回 wiki
- `lint` — 健康檢查，找出斷鏈、孤立頁面、矛盾內容
- `map` — 重建 index、MOC 及交叉連結
- `capture` — 在里程碑結束後萃取設計決策與教訓

```bash
npx skills add RayChang/agent-skills@kb-wiki
```

**首次使用（init）：**

1. `cd` 進入要建立知識庫的專案目錄
2. 執行 `/kb-wiki init`（或告訴 Claude「初始化這個專案的 KB」）
3. Claude 會讀取 `CLAUDE.md` / `README.md` / `package.json` 了解專案性質，提案合適的分類結構讓你確認
4. 確認後自動建立：
   - `kb/raw/sources/`、`kb/raw/assets/`（原始素材層，不可變動）
   - `kb/wiki/{categories}/`（LLM 維護的 wiki 層）
   - `kb/schema.md`（本專案的 KB 規則）
   - `kb/wiki/index.md`、`kb/wiki/log.md`
   - 在專案根的 `CLAUDE.md`（若不存在會建立）或 `AGENTS.md` 附加 `## Knowledge Base` 區塊，讓後續任何 LLM agent 進專案都能自動發現 KB

**日常流程：**

1. 把文件丟進 `kb/raw/sources/`（PDF、文章、會議紀錄等；搭配 Obsidian Web Clipper 擷取網頁最方便）
2. `/kb-wiki ingest` — LLM 讀取、摘要、整合進 wiki，更新 index 與 log
3. 有問題就 `/kb-wiki query <問題>` 或自然語言提問，好答案會自動歸檔回 wiki
4. 定期 `/kb-wiki lint` 與 `/kb-wiki map` 維護健康度

---

### `markitdown`

使用 Microsoft 的 [markitdown](https://github.com/microsoft/markitdown) 將檔案或 URL 轉換為 Markdown，透過 `uvx` 免安裝執行。

支援 PDF、Word、PowerPoint、Excel、HTML、EPUB、CSV、JSON、XML、ZIP、音訊、YouTube URL 等格式。

```bash
npx skills add RayChang/agent-skills@markitdown
```

---

### `cove`

基於 Meta AI 的 [Chain-of-Verification（CoVe）論文](https://arxiv.org/abs/2309.11495)，透過結構化的四步驟自我驗證流程減少 LLM 的 hallucination。

以 `/cove` 手動觸發，對前一個回應（或指定內容）進行驗證與修訂。

**四步驟流程：**

1. 取得待驗證的初稿
2. 針對關鍵事實、技術陳述、邏輯斷言規劃驗證問題
3. 獨立回答每個驗證問題（不參照原稿，避免 self-confirmation bias）
4. 對照驗證結果修訂初稿，標示無法驗證的內容

適合用於事實密集的回答、技術說明、或任何對準確性要求較高的場景。

```bash
npx skills add RayChang/agent-skills@cove
```
