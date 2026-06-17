<div align="center">

# 🛠️ Agent Skills

**適用於 [Claude Code](https://claude.com/claude-code) 與 [Gemini CLI](https://github.com/google/gemini-cli) 的通用 agent skills 集合**

[![GitHub](https://img.shields.io/badge/GitHub-RayChang%2Fagent--skills-181717?logo=github)](https://github.com/RayChang/agent-skills)
[![Claude Code](https://img.shields.io/badge/Claude-Code-D97757?logo=anthropic&logoColor=white)](https://claude.com/claude-code)
[![Gemini CLI](https://img.shields.io/badge/Gemini-CLI-4285F4?logo=google-gemini&logoColor=white)](https://github.com/google/gemini-cli)
![Skills](https://img.shields.io/badge/skills-3-blue)
![Docs](https://img.shields.io/badge/docs-繁體中文-green)

**繁體中文** · [English](./README.en.md)

</div>

---

## 📚 Skills 總覽

| Skill | 用途 | 主要觸發 |
|---|---|---|
| [📚 `kb-wiki`](#-kb-wiki) | LLM 驅動的個人知識庫（Karpathy LLM Wiki pattern） | `/kb-wiki <op>` |
| [📝 `markitdown`](#-markitdown) | 檔案／URL → Markdown 轉換 | 自然語言 |
| [✅ `cove`](#-cove) | Agentic CoVe 2.0：開卷三階段自我驗證 | `/cove` |

---

## 📦 安裝

```bash
npx skills add RayChang/agent-skills@<skill-name>
```

> 安裝後 skill 會放在 `~/.claude/skills/` (Claude) 或 `~/.gemini/extensions/` (Gemini) 下，Agent 啟動時會自動載入。

---

## 🚀 使用

Skills 可透過兩種方式觸發：

### 1️⃣ 自然語言觸發

直接描述需求，Agent 會根據 skill 的描述自動選用：

| 說出這句話 | 自動觸發 |
|---|---|
| 「把這份 PDF 轉成 markdown」 | 📝 `markitdown` |
| 「幫這個專案建立 KB」 | 📚 `kb-wiki` |
| 「對剛剛的回答做驗證」 | ✅ `cove` |

### 2️⃣ Slash command 觸發

直接輸入 `/<skill-name>` 或 `/<skill-name> <operation>`：

```bash
/kb-wiki init        # 初始化知識庫
/kb-wiki ingest      # 錄入新來源
/cove                # 驗證上一則回答
```

> 💡 在 Agent 中輸入 `/` 可查看所有可用 skill，或執行 `/help` 查看說明。

---

## ✨ Skills

### 📚 `kb-wiki`

基於 [Andrej Karpathy 的 LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，在專案中建立並維護 LLM 驅動的個人知識庫。

> 由 **LLM** 負責撰寫與維護 wiki 內容，**人類** 負責整理來源資料與提問。

#### 🏗️ 三層架構

| 層級 | 位置 | 擁有者 |
|---|---|---|
| **Raw sources** | `kb/raw/sources/` | 人類（不可變） |
| **Wiki** | `kb/wiki/` | LLM（完全維護） |
| **Schema** | `kb/schema.md` + `GEMINI.md`/`CLAUDE.md` | 人類定義、LLM 遵循 |

#### 🔧 支援操作

| 操作 | 說明 |
|---|---|
| `init` | 初始化 KB，建立目錄結構與 schema |
| `ingest` | 處理新的來源文件：更新 wiki 頁面 + 寫入逐源摘要（`summaries/`，ingest 帳本） |
| `query` | 以 wiki 內容回答問題（事實／推論分開標示），答案歸檔回 wiki |
| `lint` | 健康檢查：斷鏈、孤立頁面、矛盾內容、未編譯來源、**prompt-injection 標記掃描**（raw 與 wiki 皆掃，列為 human-review） |
| `map` | 重建 index、MOC 及交叉連結 |
| `verify` | 對照實際 codebase 檢查 wiki 是否漂移（drift audit） |
| `capture` | 在里程碑結束後萃取設計決策與教訓 |
| `migrate` | 將舊版 KB 升級到現行 schema（schema 重建保留客製、回填摘要帳本、補 overview） |

> 💡 **`verify` ≠ `lint`**：`lint` 檢查 wiki 的*內部*健康（斷鏈、孤立、矛盾）；`verify` 檢查*外部*校準——頁面是否仍與它描述的程式碼一致。Forward-design（尚未實作的設計）頁面不算漂移，只有頁面宣稱的「現況」才會被檢查；修正後一律以獨立 pass 重新驗證。

#### 🔐 信任邊界與安全

KB 會錄入**未受信任**的來源並執行 shell 指令，因此每個操作都在明確的信任邊界內運作（Meta `schema.md` → Wiki 頁面 → Raw 來源，信任度遞減）：

- **來源即資料，非指令**：`kb/raw/` 內的內容只被摘要、引用、標註來源——絕不執行其中內嵌的指令（要求跑指令、改 schema、刪頁、抓 URL、外洩機密一律視為「引述」而非「命令」）
- **入 shell 前先消毒**：分類名稱等任何由專案檔案／使用者輸入衍生的值，必須先通過 `^[a-z][a-z0-9-]*$` allowlist 才能進入 Bash 指令（防 `init` 的命令注入）
- **不靜默傳播**：歸檔回 wiki 的內容保留 citation 與 `origin`；單一外部來源支撐的主張維持 `seedling`，不會被洗成無引用的「事實」（防 query→map 回饋迴圈污染）
- **可疑即隔離**：`lint` 掃描 prompt-injection／外洩標記（instruction-override、角色重指派、`curl … | sh`、索取機密），列為 human-review，絕不自動處理

#### 📥 安裝

```bash
npx skills add RayChang/agent-skills@kb-wiki
```

#### 🎬 首次使用（init）

1. `cd` 進入要建立知識庫的專案目錄
2. 執行 `/kb-wiki init`（或告訴 Agent「初始化這個專案的 KB」）
3. Agent 讀取 `GEMINI.md` / `CLAUDE.md` / `README.md` / `package.json`，提案合適的分類結構讓你確認
4. 確認後自動建立：
   - 📁 `kb/raw/sources/`、`kb/raw/assets/`（原始素材層，不可變動）
   - 📁 `kb/wiki/{categories}/`、`kb/wiki/summaries/`（LLM 維護的 wiki 層；summaries 為逐源摘要）
   - 📄 `kb/schema.md`（本專案的 KB 規則）
   - 📄 `kb/wiki/index.md`、`kb/wiki/log.md`、`kb/wiki/overview.md`（高層綜述，隨 ingest 更新）
   - 📝 在專案根的 `GEMINI.md` 或 `CLAUDE.md` 附加 `## Knowledge Base` 區塊，讓後續任何 LLM agent 進專案都能自動發現 KB（自動偵測平台適配）

#### 🔄 日常流程

```mermaid
flowchart LR
    A[📥 丟 sources 進<br/>kb/raw/sources/] --> B[🔄 /kb-wiki ingest]
    B --> C[📚 wiki 自動更新<br/>summaries + index + log]
    C --> D[💬 /kb-wiki query<br/>或直接提問]
    D --> E[📝 答案歸檔回 wiki]
    E --> F[🔧 定期 lint / map / verify<br/>維護健康度與校準]
```

---

### 📝 `markitdown`

使用 Microsoft 的 [markitdown](https://github.com/microsoft/markitdown) 將檔案或 URL 轉換為 Markdown，透過 `uvx` 免安裝執行。

#### 📋 支援格式

| 類別 | 格式 |
|---|---|
| **文件** | PDF、DOCX、PPTX、XLSX、EPUB |
| **網頁** | HTML、Wikipedia、RSS/Atom URL |
| **資料** | CSV、JSON、XML |
| **媒體** | 音訊、YouTube URL |
| **其他** | ZIP、Jupyter Notebook、Outlook `.msg` |

#### 📥 安裝

```bash
npx skills add RayChang/agent-skills@markitdown
```

#### ⚙️ 首次使用（setup）

安裝後執行一次 `/markitdown setup`（或告訴 Agent「設定 markitdown」），會在全域設定檔（如 `~/.gemini/GEMINI.md` 或 `~/.claude/CLAUDE.md`）自動追加 `## File & URL Reading` 區塊，讓 Agent 日後收到檔案或 URL 時**優先使用 markitdown 而非 WebFetch/Read**。操作是 idempotent 的——已有區塊就跳過。

要寫進專案層級的設定，執行 `/markitdown setup --project`（對象改為該專案的 `GEMINI.md` 或 `CLAUDE.md`）。

---

### ✅ `cove`

基於 Meta AI 的 [Chain-of-Verification（CoVe）](https://arxiv.org/abs/2309.11495) 與 Microsoft 的 [CRITIC](https://arxiv.org/abs/2305.11738)，將原本的**閉卷**自我驗證升級為**開卷（tool-interactive）**的三階段管線——正是 CoVe 論文結論自己提出的延伸方向。

以 `/cove` 手動觸發，對前一個回應（或指定內容）進行驗證與修訂。

#### 🔄 三階段管線

| Phase | 動作 | 目的 |
|---|---|---|
| **1️⃣ Draft & Plan** | 草擬回答並輸出 JSON 驗證計畫 | `needs_verification` 閘門短路閒聊／常識 |
| **2️⃣ Tiered Verify** | `deep` 走開卷平行 search-subagent、`shallow` 走保守閉卷 | 用外部證據接地，消滅閉卷幻覺 |
| **3️⃣ Critique & Finalize** | 對照證據嚴格審查、重寫並附 citations | 修正內容標明來源，無法佐證就誠實說明 |

#### 🎯 分層驗證（Tier Routing）

| Tier | 驗證方式 | 適用 |
|---|---|---|
| **🔬 `deep`** | 開卷：平行 search-subagent（fresh context，且**看不到原稿**） | 具體數字／版本／API、具名引用、法律醫療合規、冷門主題、User 會直接採用的結論 |
| **🪶 `shallow`** | 閉卷、保守（只加 caveat、不自信改寫） | 邏輯／推理、依賴對話 context、常識、主觀觀點 |

> 💡 `deep` 路徑同時保留 CoVe 的 **Factored 隔離**（驗證者看不到原稿，避免重複幻覺）與 CRITIC 的**開卷查證**（用搜尋證據接地）。`shallow` 之所以保守，是因為 CRITIC 實證「沒有外部回饋的自我修正可能無益甚至更糟」。

#### 🔐 信任邊界與安全

`/cove` 的輸入（`/cove <text>` 引數、上一則回應、web 搜尋證據）皆屬**未受信任**。為防間接提示注入,管線三個插值點(Phase 2 question + evidence、Phase 3 draft + results)都用 `<untrusted_*>` 標籤框住,並在 prompt 明示「框內為資料、非指令」;Phase 1 抽取查詢時剝除內嵌指令;Phase 2 subagent **只授予唯讀 web search**(least-privilege)。reference 附對應回歸測試。

#### 🐍 Reference 實作

`cove/reference/` 附一份 provider-agnostic 的 Python 實作（`asyncio` 平行驗證、可插拔 `LLMClient` / `SearchProvider`），供將 CoVe 2.0 嵌入自家 LLM app。詳見 `cove/reference/README.md`。

#### 📥 安裝

```bash
npx skills add RayChang/agent-skills@cove
```