# sync-locales-from-en

English | [简体中文](./README.zh-CN.md)

An AI skill that syncs locale translation files with `messages/en/` as the source of truth. Detects missing keys, translates them via LLM, and merges back — keeping key order and file structure intact.

Built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Codex, and [Cursor](https://cursor.com/) as an installable skill, but also works standalone via `pnpm` scripts.

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
2. **Extract** — generate flat `draft/{locale}-{NNN}.json` chunk files with `{file}::{dotpath}` keys (max 50 keys per chunk)
3. **Blueprint** — during AI skill runs, the advisor writes run-scoped advisor/executor contracts into `temp/YYYY-MM-DD/blueprint/`
4. **Copy draft** — copy draft → translation (preserves interrupted work only for a true resume with the same run-context signature)
5. **Translate** — LLM translates `translation/{locale}-{NNN}.json` values (one executor subagent per chunk, launched through a bounded worker pool)
6. **Unflatten** — convert flat translated files back to nested JSON
7. **Merge** — write translations into `messages/{locale}/`, preserving key order
8. **Test** — validate all locales match en/ structure

## Installation

### As a Claude Code / Codex / Cursor skill

1. Install the skill (method depends on skills.sh or manual installation)
2. Run the setup script to configure your project automatically:
   ```bash
   bash .agents/skills/sync-locales-from-en/scripts/setup.sh
   ```
   This will:
   - Add all `i18n:*` scripts to your `package.json` (appended to the end of scripts)
   - Add temp file exclusions to your `.gitignore`
   - Install `tsx` and `@types/node` as devDependencies (auto-detects pnpm/yarn/bun/npm)

   `.agents/skills` is the canonical path. If you also want Claude Code compatibility, keep `.claude/skills` as a symlink to `.agents/skills`.

<details>
<summary>Manual setup (if you prefer not to use the setup script)</summary>

1. Add to your project's `.gitignore`:
   ```
   # i18n translation temp files
   .agents/skills/sync-locales-from-en/temp/
   ```
2. Add to your project's `package.json` scripts:
   ```json
   {
     "scripts": {
       "i18n:compare": "tsx .agents/skills/sync-locales-from-en/scripts/compare-locales.ts",
       "i18n:extract": "tsx .agents/skills/sync-locales-from-en/scripts/extract-locales.ts",
       "i18n:copy-draft": "tsx .agents/skills/sync-locales-from-en/scripts/copy-locales-draft.ts",
       "i18n:unflatten": "tsx .agents/skills/sync-locales-from-en/scripts/unflatten-translations.ts",
       "i18n:merge": "tsx .agents/skills/sync-locales-from-en/scripts/merge-translations.ts",
       "i18n:test": "tsx .agents/skills/sync-locales-from-en/scripts/test-locales.ts"
     }
   }
   ```
3. Install dependencies: `pnpm add -D tsx @types/node`
</details>

### Standalone (without AI skill)

Clone this repo into your project and run the setup script, or follow the manual setup steps above.

## Usage

### Approach 1: AI skill (recommended)

If you have Claude Code, Codex, or Cursor installed, just run:

```
/sync-locales-from-en
```

The AI agent handles the full pipeline automatically, launching parallel executor subagents per chunk file (max 50 keys each).

In Codex/OpenAI environments, parallel executor fan-out happens when the user explicitly asks for subagents, delegation, or parallel agent work. Otherwise the advisor should keep processing the chunk queue serially in the main agent instead of stopping after `copy-draft`.

For AI-driven runs, the advisor also snapshots the run behavior into `temp/YYYY-MM-DD/blueprint/` before launching executors. This keeps retries and resumed runs deterministic even if the skill instructions evolve later.

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

The translate step is intentionally manual — use whatever LLM or translation service you prefer. The `translation/{locale}-{NNN}.json` files are flat JSON objects, easy to feed into any API.

The `blueprint/` step is only required for AI-orchestrated runs. The advisor writes those files directly during the skill run; there is no separate `pnpm i18n:blueprint` command.

## Advisor / Executor blueprint

The AI skill uses an advisor/executor pattern:

- Advisor = the orchestrator for compare, extract, blueprint generation, executor launch, retry decisions, and final summary
- Executors = chunk translators that each handle one `translation/{locale}-{NNN}.json` file

For each run, the skill creates a behavior snapshot in `temp/YYYY-MM-DD/blueprint/`:

- `advisor.md` — human-readable run intent
- `advisor.json` — machine contract for sequencing, models, directories, and retry policy
- `executor-translation.md` — human-readable translation policy
- `executor-translation.json` — strict executor contract with input rules and output schema

Executors should receive a small JSON task envelope with refs such as `translation_file_ref` and blueprint refs, instead of a long repeated prompt body. This keeps context small and makes cross-model behavior more consistent.

The advisor should also record a deterministic run-context signature in `advisor.json`, based on the normalized missing-keys report, sorted draft chunk filenames, batch size, and model defaults. Same-day temp artifacts in `translation/` and `final/` are reusable only when that signature matches exactly; otherwise the advisor should invalidate those derived artifacts before resuming.

For resumable runs, the advisor should persist a chunk registry in `advisor.json` and launch only chunks that are still `pending`, `retry_needed`, `failed`, or `timed_out`. Chunks already marked `ok` should be preserved and skipped.

## Intermediate format

Translation files use a flat JSON format split into chunks (max 50 keys per file) to avoid broken nested JSON and Write tool truncation from LLM output:

```json
// draft/es-001.json (first 50 keys)
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

When a locale has many missing keys (50+), LLM executor subagents may truncate the output. This is now mitigated by batch chunking — `pnpm i18n:extract` splits large locales into chunk files of max 50 keys each (`es-001.json`, `es-002.json`, etc.), and one executor subagent handles each chunk.

If a chunk still fails, delete the bad `translation/{locale}-{NNN}.json`, re-run `pnpm i18n:copy-draft`, and retry.

For AI-driven runs, executors should not be waited on forever. The advisor should poll with bounded waits, replace timed-out chunks, and escalate a stubborn chunk to the advisor-tier model before giving up on the run.

Executors should also be launched through a bounded worker pool instead of unbounded fan-out. A safe default is `max_parallel_executors = 4`, lowered when the runtime exposes a smaller safe worker limit.

### Executor subagent freezing / interruption

Executor subagents can freeze or be interrupted mid-translation. The `translation/` layer preserves partially-completed work, and on a true resume with the same run-context signature `pnpm i18n:copy-draft` skips chunks that already have a file in `translation/`, so completed translations aren't lost. The advisor should also persist chunk status back into `blueprint/advisor.json` so resumes can distinguish translated chunks from untouched draft copies.

## Project structure

```
.agents/skills/sync-locales-from-en/
  SKILL.md                          # skill definition
  scripts/
    helpers.ts                      # shared utilities
    compare-locales.ts              # find missing keys
    extract-locales.ts              # generate draft files
    copy-locales-draft.ts           # copy draft → translation
    unflatten-translations.ts       # flat → nested JSON
    merge-translations.ts           # merge into messages/
    test-locales.ts                 # validate structure
    setup.sh                        # auto-setup script (package.json, .gitignore, deps)
  temp/YYYY-MM-DD/                  # daily working directory
    blueprint/                      # run-scoped advisor/executor contracts
    reference/                      # English values for missing keys
    draft/                          # pristine chunk files (never modified)
    translation/                    # working copy (executor subagents write here)
    final/                          # unflattened nested JSON
```

## License

MIT
