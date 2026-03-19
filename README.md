# sync-locales-from-en

English | [简体中文](./README.zh-CN.md)

An AI skill that syncs locale translation files with `messages/en/` as the source of truth. Detects missing keys, translates them via LLM, and merges back — keeping key order and file structure intact.

Built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) / [Cursor](https://cursor.com/) as an installable skill, but also works standalone via `pnpm` scripts.

## How it works

```
messages/en/main.json  (source of truth)
messages/de/main.json  (auto-synced)
messages/es/main.json  (auto-synced)
messages/fr/main.json  (auto-synced)
messages/zh/main.json  (auto-synced)
```

The pipeline:

1. **Compare** — find missing keys per locale
2. **Extract** — generate flat `draft/{locale}-{NNN}.json` chunk files with `{file}::{dotpath}` keys (max 200 keys per chunk)
3. **Copy draft** — copy draft → translation (preserves interrupted work)
4. **Translate** — LLM translates `translation/{locale}-{NNN}.json` values (one subagent per chunk)
5. **Unflatten** — convert flat translated files back to nested JSON
6. **Merge** — write translations into `messages/{locale}/`, preserving key order
7. **Test** — validate all locales match en/ structure

## Installation

### As a Claude Code / Cursor skill

1. Install the skill (method depends on skills.sh or manual installation)
2. Add to your project's `.gitignore`:
   ```
   # i18n translation temp files
   .agents/skills/sync-locales-from-en/temp/
   .claude/skills/sync-locales-from-en/temp/
   ```
3. Add to your project's `package.json` scripts:
   ```json
   {
     "scripts": {
       "i18n:compare": "tsx .claude/skills/sync-locales-from-en/scripts/compare-locales.ts",
       "i18n:extract": "tsx .claude/skills/sync-locales-from-en/scripts/extract-locales.ts",
       "i18n:copy-draft": "tsx .claude/skills/sync-locales-from-en/scripts/copy-locales-draft.ts",
       "i18n:unflatten": "tsx .claude/skills/sync-locales-from-en/scripts/unflatten-translations.ts",
       "i18n:merge": "tsx .claude/skills/sync-locales-from-en/scripts/merge-translations.ts",
       "i18n:test": "tsx .claude/skills/sync-locales-from-en/scripts/test-locales.ts"
     }
   }
   ```
4. Install dependencies: `pnpm add -D tsx @types/node`

### Standalone (without AI skill)

Clone this repo into your project and follow steps 2-4 above.

## Usage

### Approach 1: AI skill (recommended)

If you have Claude Code or Cursor installed, just run:

```
/sync-locales-from-en
```

The AI agent handles the full pipeline automatically, launching parallel translation subagents per chunk file (max 200 keys each).

### Approach 2: Manual via pnpm

Run each step yourself:

```bash
pnpm i18n:compare      # find missing keys
pnpm i18n:extract      # generate draft files
pnpm i18n:copy-draft   # copy draft → translation
# ... translate translation/*.json yourself or with any LLM ...
pnpm i18n:unflatten    # convert flat → nested JSON
pnpm i18n:merge        # merge into messages/
pnpm i18n:test         # validate
```

The translate step is intentionally manual — use whatever LLM or translation service you prefer. The `translation/{locale}.json` files are flat JSON objects, easy to feed into any API.

## Intermediate format

Translation files use a flat JSON format split into chunks (max 200 keys per file) to avoid broken nested JSON and Write tool truncation from LLM output:

```json
// draft/es-001.json (first 200 keys)
{
  "main.json::home.feature.title": "Welcome to our platform",
  "main.json::home.feature.description": "The best way to manage your projects",
  "ui.json::buttons.submit": "Submit"
}
```

Keys are never modified — only values get translated. Chunks are merged automatically during the unflatten step.

## Key ordering

Merged JSON files follow a specific key order at every nesting level:

1. `title` first
2. `description` second
3. Numbered keys (`1`, `2`, `3`...) sorted numerically
4. Everything else in original order

This is enforced by a custom JSON serializer since V8 always enumerates integer keys before string keys regardless of insertion order.

## Known issues

### Subagent output truncation (mitigated)

When a locale has many missing keys (200+), LLM subagents may truncate the output. This is now mitigated by batch chunking — `pnpm i18n:extract` splits large locales into chunk files of max 200 keys each (`es-001.json`, `es-002.json`, etc.), and one subagent handles each chunk.

If a chunk still fails, delete the bad `translation/{locale}-{NNN}.json`, re-run `pnpm i18n:copy-draft`, and retry.

### Subagent freezing / interruption

Subagents can freeze or be interrupted mid-translation. The `translation/` layer preserves partially-completed work — `pnpm i18n:copy-draft` skips chunks that already have a file in `translation/`, so completed translations aren't lost.

## Project structure

```
.claude/skills/sync-locales-from-en/
  SKILL.md                          # skill definition
  scripts/
    helpers.ts                      # shared utilities
    compare-locales.ts              # find missing keys
    extract-locales.ts              # generate draft files
    copy-locales-draft.ts           # copy draft → translation
    unflatten-translations.ts       # flat → nested JSON
    merge-translations.ts           # merge into messages/
    test-locales.ts                 # validate structure
  temp/YYYY-MM-DD/                  # daily working directory
    reference/                      # English values for missing keys
    draft/                          # pristine chunk files (never modified)
    translation/                    # working copy (subagents write here)
    final/                          # unflattened nested JSON
```

## License

MIT
