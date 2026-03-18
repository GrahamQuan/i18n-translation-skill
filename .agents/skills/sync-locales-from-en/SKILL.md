---
name: sync-locales-from-en
description:
  Sync all locale translation files with en/ as the base reference. Finds missing keys, translates them, and merges back.
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
batchSize: 200
metadata:
  author: GrahamQuan
  version: "1.0.0"
---

# sync-locales-from-en

Synchronize all locale translation files with `messages/en/` as the base reference. Messages use a directory-based structure: `messages/{locale}/{file}.json`.

## One-click workflow

1. **Compare** — `pnpm i18n:compare` finds missing keys per locale
2. **Extract** — `pnpm i18n:extract` generates reference files + draft flat files for LLM translation
3. **Prepare** — Copy `draft/` → `translation/` (only locales not yet in `translation/`)
4. **Translate** — Sonnet subagents translate flat `translation/{locale}.json` files in parallel
5. **Unflatten** — `pnpm i18n:unflatten` converts translated files into nested JSON in `final/`
6. **Merge** — `pnpm i18n:merge` writes translations back, preserving en.json key order
7. **Test** — `pnpm i18n:test` validates all locales match en.json structure

## Hard constraints (must follow)

- Never create ad-hoc runner scripts or inline interpreter blocks.
- Forbidden patterns: `python - <<`, `node -e`, `tsx -e`, `bash <<`, heredoc scripts that execute custom code.
- Never create new temporary executable files (`.py`, `.sh`, `.js`, `.ts`) for this workflow.
- Use only pre-existing repo scripts for automation:
  - `pnpm i18n:compare`
  - `pnpm i18n:extract`
  - `pnpm i18n:copy-draft`
  - `pnpm i18n:unflatten`
  - `pnpm i18n:merge`
  - `pnpm i18n:test`
- Translation is handled by sonnet subagents via the Agent tool. Do not call external translation APIs.
- If a required script is missing or fails, stop and ask the user before taking another approach.

## Prerequisites

- `messages/en/` is the source of truth (contains `main.json`, `ui.json`, `model.json`, etc.)
- Locales are auto-discovered from directories in `messages/` (excluding `en/`)

## Scripts

All scripts live in `.claude/skills/sync-locales-from-en/scripts/`:

- `helpers.ts` — Shared utilities (flatten, unflatten, key ordering, locale discovery, temp dir constants)
- `compare-locales.ts` — Find missing keys per locale per file, output report to `temp/YYYY-MM-DD/reference/`
- `extract-locales.ts` — Create `reference/{file}.json` (English union) and `draft/{locale}.json` (flat key::value per locale)
- `copy-locales-draft.ts` — Copy `draft/{locale}.json` → `translation/{locale}.json`, skipping locales already in `translation/`
- `unflatten-translations.ts` — Read translated `translation/{locale}.json`, split by file, unflatten → `final/{locale}/{file}.json`
- `merge-translations.ts` — Merge `temp/YYYY-MM-DD/final/{locale}/{file}.json` into `messages/{locale}/{file}.json` with en key order
- `test-locales.ts` — Validate all locale files match en/ structure (missing keys, extra keys, structure)

## Temp directory layout

```
.claude/skills/sync-locales-from-en/temp/YYYY-MM-DD/
  reference/
    missing-keys-report.json
    main.json                    # English values for missing keys (union across locales)
    ui.json
    model.json
  draft/
    de.json                      # Flat key::value for LLM translation (pristine, never modified)
    es.json
    fr.json
    zh.json
  translation/
    de.json                      # Copied from draft/, subagents write translations here
    es.json                      # If a subagent is interrupted, this file persists
    fr.json
    zh.json
  final/
    de/main.json                 # Nested JSON, unflattened from translated files
    de/ui.json
    es/...
```

## Draft / Translation file format

Each `draft/{locale}.json` and `translation/{locale}.json` is a flat JSON object with `{file}::{dotpath}` keys:

```json
{
  "main.json::home.feature.title": "Welcome to our platform",
  "main.json::home.feature.description": "The best way to manage your projects",
  "ui.json::buttons.submit": "Submit",
  "model.json::errors.notFound": "Resource not found"
}
```

After LLM translation:

```json
{
  "main.json::home.feature.title": "Willkommen auf unserer Plattform",
  "main.json::home.feature.description": "Der beste Weg, Ihre Projekte zu verwalten",
  "ui.json::buttons.submit": "Absenden",
  "model.json::errors.notFound": "Ressource nicht gefunden"
}
```

## Execution Steps

When `/sync-locales-from-en` is invoked, follow these steps exactly:

### Step 1: Compare

Run `pnpm i18n:compare` to generate the missing keys report at `temp/YYYY-MM-DD/reference/missing-keys-report.json`.

If no missing keys are found, stop here.

### Step 2: Extract

Run `pnpm i18n:extract` to generate:
- `temp/YYYY-MM-DD/reference/{file}.json` — English values for all missing keys (union across locales)
- `temp/YYYY-MM-DD/draft/{locale}.json` — Flat JSON with `{file}::{dotpath}` keys and English values

### Step 3: Prepare translation/

Run `pnpm i18n:copy-draft` to copy `draft/{locale}.json` → `translation/{locale}.json`. Locales already in `translation/` (from a previous interrupted run) are skipped — partially-translated files are preserved.

### Step 4: Translate (sonnet subagents)

Launch one sonnet subagent per locale using the Agent tool with `run_in_background: true` and `model: "sonnet"`. All subagents run in parallel.

Each subagent translates the flat file at `temp/YYYY-MM-DD/translation/{locale}.json`.

Each subagent receives this prompt template (fill in `{locale}`, `{language}`, and `{translation_file}`):

```
You are a professional translator. Translate the JSON file at `{translation_file}` from English to {language} ({locale}).

The file is a flat JSON object where keys use the format `{source_file}::{dotpath}` and values are English text:

{
  "main.json::home.title": "Welcome",
  "ui.json::buttons.submit": "Submit"
}

Instructions:
1. Read the JSON file at `{translation_file}`.
2. Translate ONLY the string values to {language}. Keep all JSON keys exactly as-is.
3. Write the translated JSON back to the same file path.

Translation rules:
- Translations must be SEO-friendly and natural for native speakers of {language}
- Preserve all HTML tags exactly as-is (e.g. <br>, <strong>, <a href="...">)
- Preserve all {variable} placeholders exactly as-is (e.g. {name}, {count})
- Preserve special formatting (newlines, markdown, etc.)
- Do not translate brand names or product names

Read the file, translate all values, write it back.
```

`{translation_file}` should be set to `.claude/skills/sync-locales-from-en/temp/YYYY-MM-DD/translation/{locale}.json`.

After launching all subagents, wait for all to complete by polling with `TaskOutput`.

Language mapping (locale → language name):
- de → German, es → Spanish, fr → French, zh → Simplified Chinese
- ar → Arabic, cn → Simplified Chinese, id → Indonesian, it → Italian
- ja → Japanese, ko → Korean, pt → Portuguese, ru → Russian
- th → Thai, tw → Traditional Chinese, vi → Vietnamese
- For unknown locales, use the locale code as the language name

### Step 5: Unflatten

Run `pnpm i18n:unflatten` to convert translated `translation/{locale}.json` flat files into nested JSON at `final/{locale}/{file}.json`.

### Step 6: Merge

Run `pnpm i18n:merge` to merge translated files from `temp/YYYY-MM-DD/final/{locale}/{file}.json` into `messages/{locale}/{file}.json`. Existing translations are preserved; new keys are added. Key order follows en/{file}.json.

### Step 7: Test

Run `pnpm i18n:test` to validate all locale files match en/ structure.

Report summary: which locales succeeded, which failed, which need retry.

## Translation rules

- Translations must be SEO-friendly and natural for native speakers
- Preserve all HTML tags exactly as-is
- Preserve all `{variable}` placeholders exactly as-is
- Preserve special formatting (newlines, markdown, etc.)
- Do not translate brand names or product names
- Use the language name from `getLanguageName()` in helpers.ts for translation prompts

## Roadmap

### v1 (previous)
Basic pipeline: compare → extract → translate (Google Translate free API) → merge → test

### v1.5 (previous)
- Directory-based messages: `messages/{locale}/{file}.json`
- Sonnet subagents replace Google Translate
- Parallel subagents per locale for speed
- Batch keys (25 per prompt cycle) to reduce token overhead
- `messages/en/` as sole base

### v2 (current)
- Flat JSON format: `{file}::{dotpath}` keys for safer LLM translation
- No nested JSON during translation — eliminates broken JSON structure risk
- Token-efficient: flat key-value pairs instead of nested JSON
- Draft/translation split: `draft/` stays pristine, `translation/` is the working copy
- Interrupted subagents can be resumed — `translation/{locale}.json` persists
- New `unflatten` step converts translated flat files back to nested JSON
