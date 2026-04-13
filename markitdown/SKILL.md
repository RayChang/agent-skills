---
name: markitdown
description: Convert files and URLs to Markdown using Microsoft's markitdown library via uvx (zero-install). This skill should be used when the user provides a file (PDF, DOCX, PPTX, XLSX, HTML, CSV, JSON, XML, EPUB, Jupyter notebook, audio, ZIP) or a URL (including YouTube, Wikipedia, RSS feeds) and wants its content converted to Markdown for context ingestion. Also triggers when the user explicitly asks to convert a file to Markdown, read a non-text document, extract content from a URL, batch convert documents, or do document analysis.
---

# MarkItDown

Convert files and URLs to Markdown using Microsoft's markitdown via `uvx` (zero-install). Preserves document structure (headings, lists, tables, links) for optimal LLM context ingestion.

## When to Use

Trigger this skill when:
- The user provides a file path with a supported extension
- The user provides a URL and asks to read/convert its content
- The user says "convert to markdown", "read this file", "extract content from..."
- The user provides a YouTube URL and wants the transcript
- The user wants to batch convert a directory of documents
- The user asks for document analysis or content extraction
- The user provides a Wikipedia URL or RSS feed URL

**Do NOT use for:**
- Plain text files (.txt, .md) — use the Read tool directly
- Image files (.jpg, .png, .gif) — use the Read tool directly (multimodal)
- Source code files — use the Read tool directly

## Quick Reference

| File Type | Use Case | Command |
|-----------|----------|---------|
| PDF | Reports, papers | `markitdown report.pdf` |
| DOCX | Word documents | `markitdown document.docx` |
| PPTX | Presentations | `markitdown slides.pptx` |
| XLSX/XLS | Spreadsheets, data tables | `markitdown data.xlsx` |
| HTML | Web pages | `markitdown page.html` |
| URL | Live web content | `markitdown "https://example.com"` |
| YouTube | Video transcripts | `markitdown "https://youtube.com/watch?v=..."` |
| Wikipedia | Wiki articles | `markitdown "https://en.wikipedia.org/wiki/..."` |
| RSS/Atom | Feed content | `markitdown "https://example.com/feed.xml"` |
| .ipynb | Jupyter notebooks | `markitdown notebook.ipynb` |
| CSV/JSON/XML | Structured data | `markitdown data.csv` |
| ZIP | Archive contents (iterates) | `markitdown archive.zip` |
| Audio | EXIF metadata | `markitdown recording.wav` |
| EPUB | E-books | `markitdown book.epub` |
| MSG | Outlook emails | `markitdown email.msg` |

All commands above are shorthand for: `uvx --from 'markitdown[all]' markitdown "<source>"`

## Conversion Command

```bash
uvx --from 'markitdown[all]' markitdown "<source>"
```

Options:
- `-o <output.md>` — write to file instead of stdout
- `-p` / `--use-plugins` — enable 3rd-party plugins
- `-x <ext>` — hint file extension (useful when reading from stdin)
- `-d` — use Azure Document Intelligence (requires `-e <endpoint>`)
- `--keep-data-uris` — keep base64-encoded images in output (truncated by default)

## Workflow

### Step 1: Convert

```bash
uvx --from 'markitdown[all]' markitdown "<source>"
```

### Step 2: Handle output size

- **Short output (< 500 lines):** Display directly in the conversation
- **Long output (>= 500 lines):** Save with `-o /tmp/markitdown_output.md`, then read relevant sections as needed
- **User wants to save:** Use `-o` with the user's specified path

### Step 3: Context integration

After conversion, use the Markdown content to answer the user's questions or proceed with their task.

## Batch Conversion

To convert multiple files in a directory:

```bash
for f in /path/to/docs/*.pdf; do
  uvx --from 'markitdown[all]' markitdown "$f" -o "${f%.pdf}.md"
done
```

For parallel batch conversion with multiple file types:

```bash
find /path/to/docs -type f \( -name "*.pdf" -o -name "*.docx" -o -name "*.pptx" \) | \
  xargs -P 4 -I {} sh -c 'uvx --from "markitdown[all]" markitdown "{}" -o "$(echo {} | sed "s/\.[^.]*$/.md/")"'
```

## Error Handling

| Error | Resolution |
|-------|-----------|
| `uvx` not found | Inform the user to install uv: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Conversion fails on a URL | Verify the URL is accessible; try fetching with `curl` first |
| Empty output | The file may be image-only; inform the user that text extraction was not possible |
| Stdin input | Pipe content with extension hint: `cat file \| uvx --from 'markitdown[all]' markitdown -x .html` |
| Import/dependency error | Ensure Python >= 3.10 is available; uvx handles the rest |
| Partial format support | Try selective extras: `uvx --from 'markitdown[pdf,docx]' markitdown file` |

## Advanced Usage

### MCP Server

For integration with Claude Desktop or other MCP-compatible clients, markitdown provides a dedicated MCP server:

```bash
pip install markitdown-mcp
```

### Docker

Run markitdown in an isolated container without any local installation:

```bash
docker run --rm -i ghcr.io/microsoft/markitdown:latest < document.pdf > output.md
```

### Selective Extras

To reduce download size when only specific formats are needed:

```bash
uvx --from 'markitdown[pdf]' markitdown report.pdf
uvx --from 'markitdown[docx,pptx]' markitdown presentation.pptx
```

Available extras: `pdf`, `docx`, `pptx`, `xlsx`, `xls`, `outlook`, `az-doc-intel`, `audio-transcription`, `youtube-transcription`.

## Examples

```bash
# Convert a PDF
uvx --from 'markitdown[all]' markitdown report.pdf

# Convert a URL
uvx --from 'markitdown[all]' markitdown "https://example.com/article"

# Convert and save to file
uvx --from 'markitdown[all]' markitdown presentation.pptx -o /tmp/slides.md

# YouTube transcript
uvx --from 'markitdown[all]' markitdown "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Wikipedia article
uvx --from 'markitdown[all]' markitdown "https://en.wikipedia.org/wiki/Markdown"

# Jupyter notebook
uvx --from 'markitdown[all]' markitdown analysis.ipynb

# Pipe from stdin
cat page.html | uvx --from 'markitdown[all]' markitdown -x .html

# Batch convert all PDFs in a directory
for f in *.pdf; do uvx --from 'markitdown[all]' markitdown "$f" -o "${f%.pdf}.md"; done
```
