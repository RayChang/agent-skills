# Agent Skills

適用於 Claude Code 的 agent skills 集合。

## 安裝

```bash
npx skills add RayChang/agent-skills@<skill-name>
```

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
