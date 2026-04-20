---
name: sync-locales-from-en
description:
  Sync all locale translation files with en/ as the base reference. Finds missing keys, translates them, and merges back.
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
batchSize: 50
metadata:
  author: GrahamQuan
  version: "1.4.3"
---

# sync-locales-from-en

Synchronize all locale translation files with `messages/en/` as the base reference. Messages use a directory-based structure: `messages/{locale}/{file}.json`.

## One-click workflow

1. **Compare** — `pnpm i18n:compare` finds missing keys per locale
2. **Extract** — `pnpm i18n:extract` generates reference files + draft chunk files for LLM translation
3. **Blueprint** — Generate run-scoped advisor/executor contracts in `temp/YYYY-MM-DD/blueprint/`
4. **Prepare** — Copy `draft/` → `translation/`, preserving chunk files only for a true resume with the same run-context signature
5. **Translate** — Executor subagents translate flat `translation/{locale}-{NNN}.json` chunk files through a bounded queue
6. **Unflatten** — `pnpm i18n:unflatten` converts translated files into nested JSON in `final/`
7. **Merge** — `pnpm i18n:merge` writes translations back, preserving en.json key order
8. **Test** — `pnpm i18n:test` validates all locales match en.json structure

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
- Before launching executors, generate a run-scoped `blueprint/` directory under `temp/YYYY-MM-DD/`.
- Blueprint generation is owned by the advisor during the skill run. Do not add or call a dedicated `pnpm i18n:blueprint` script for this step.
- Pass executor tasks as a minimal JSON task envelope whenever the runtime supports it. Prefer file refs such as `translation_file_ref` and `blueprint_refs` over large inline payloads.
- Enforce a strict executor output shape. If the runtime cannot enforce structured output directly, ask for the same fields in plain text or JSON text.
- Do not wait forever for executors. The advisor must use bounded polling, explicit timeout handling, and replacement retries for stuck chunks.
- Do not reuse `translation/` or `final/` artifacts from the same date unless the current run context exactly matches the previous run context.
- Do not fan out executors without a queue. The advisor must launch executors through a bounded worker pool and keep headroom for retries and orchestration.
- Translation is handled by executor subagents via the Agent tool. Do not call external translation APIs.
- In Codex/OpenAI runtimes, use `spawn_agent` for executor fan-out only when the user explicitly asked for subagents, delegation, or parallel agent work and the tool is available.
- If executor fan-out is unavailable in the current runtime or disallowed by policy, do not stop after `copy-draft`. Continue the same chunk queue locally in the advisor/main agent one chunk at a time using the same executor contract.
- Persist orchestration state. Whenever a chunk status changes, rewrite `blueprint/advisor.json` so `chunk_registry` remains the run-state source of truth across resumes.
- If a required script is missing or fails, stop and ask the user before taking another approach.

## Model strategy

- This skill must stay provider-agnostic across GPT and Claude families. Do not hard-code Claude-only model names into the workflow.
- Advisor role: run compare/extract/prepare, launch executor subagents, wait for completion, summarize failures, and decide whether any chunks need retry.
- Executor role: translate exactly one `translation/{locale}-{NNN}.json` chunk file and write the translated JSON back to the same path.
- Blueprint = the run-scoped behavioral contract stored in `temp/YYYY-MM-DD/blueprint/`.
- Context = task-specific inputs for a single executor. Keep it small and pass it as a JSON envelope with refs instead of repeating the full translation instructions in every prompt.
- Keep the advisor simple and push chunk-level translation complexity down to executors.
- In Codex environments, prefer `spawn_agent` workers for executor chunks only when delegation is explicitly allowed. Otherwise, the advisor must execute the chunk contract locally and keep draining the queue serially until all chunks are done or a real blocker occurs.
- The advisor must treat a run as resumable only when the run-context signature matches exactly. Otherwise it is a new run on the same date and stale derived artifacts must be invalidated before translation resumes.
- GPT advisor default: `gpt-5.4` with `reasoning.effort: "low"` by default. Raise to `"medium"` when the run needs more careful coordination or retry decisions.
- GPT executor default: `gpt-5.4-mini` with `reasoning.effort: "none"` by default. Raise to `"low"` only for trickier chunks with dense placeholders, markup, or ambiguous phrasing.
- Claude advisor default: `claude-opus-4-6` with `thinking: { type: "adaptive" }` and `effort: "medium"`.
- Claude executor default: `claude-sonnet-4-6` with `thinking: { type: "adaptive" }` and `effort: "low"`.
- If an exact model ID is unavailable in the current runtime, use the nearest same-tier model from the same family: flagship model for the advisor, balanced medium/mini model for the executors.
- Prefer GPT defaults in OpenAI/Codex environments and Claude defaults in Claude environments.

## Blueprint artifacts

Before any executor launch, generate a run-scoped `blueprint/` directory at `temp/YYYY-MM-DD/blueprint/` with these files:

- `advisor.md` — human-readable run intent for the advisor role
- `advisor.json` — machine-readable advisor contract for sequencing, model defaults, directories, and retry policy
- `executor-translation.md` — human-readable translation rules for executor subagents
- `executor-translation.json` — machine-readable executor contract with input schema, invariants, and output schema

Rules for these files:

- The advisor LLM writes these files directly during the skill run. Executors only read them.
- Do not create a repo script for blueprint generation. This is a runtime artifact owned by the advisor.
- Generate them fresh for a new run.
- If resuming an interrupted run on the same date and the files already exist, reuse them only when the run-context signature matches exactly.
- The `.json` files are the runtime source of truth if the `.md` wording ever drifts.
- Do not store these files under `reference/`. `reference/` is for source-content artifacts, while `blueprint/` is for run behavior.

Required advisor contract content:

- Goal: sync missing locale keys from `messages/en/`
- Ordered steps: compare, extract, blueprint, prepare, translate, unflatten, merge, test
- `run_context_signature`
- `run_context_signature_input`
- `max_parallel_executors`
- Model defaults for advisor and executor per provider
- Directory refs for `blueprint/`, `reference/`, `draft/`, `translation/`, and `final/`
- `chunk_registry`
- Retry guidance for failed or truncated executor chunks
- Ref to `executor-translation.json` as the executor contract

Required executor contract content:

- Role: executor
- Task: translate exactly one chunk file
- Input schema with `locale`, `language`, `translation_file_ref`, and blueprint refs
- Invariants:
  - Keep JSON keys unchanged
  - Translate string values only
  - Preserve HTML tags exactly
  - Preserve `{variable}` placeholders exactly
  - Preserve markdown, newlines, and other formatting
  - Do not translate brand or product names
- Output schema:
  - Write translations back to the same `translation_file_ref`
  - Return a machine-readable status summary with `status`, `locale`, `chunk_file`, and optional `notes`

## Prerequisites

- `messages/en/` is the source of truth (contains `main.json`, `ui.json`, `model.json`, etc.)
- Locales are auto-discovered from directories in `messages/` (excluding `en/`)

## Scripts

All scripts live in `.agents/skills/sync-locales-from-en/scripts/`:

- `helpers.ts` — Shared utilities (flatten, unflatten, key ordering, locale discovery, temp dir constants)
- `compare-locales.ts` — Find missing keys per locale per file, output report to `temp/YYYY-MM-DD/reference/`
- `extract-locales.ts` — Create `reference/{file}.json` (English union) and `draft/{locale}-{NNN}.json` chunks (flat key::value, max 50 keys each)
- `copy-locales-draft.ts` — Copy `draft/{locale}-{NNN}.json` → `translation/{locale}-{NNN}.json`, skipping chunks already in `translation/`
- `unflatten-translations.ts` — Read translated `translation/{locale}-{NNN}.json` chunks, merge per locale, split by file, unflatten → `final/{locale}/{file}.json`
- `merge-translations.ts` — Merge `temp/YYYY-MM-DD/final/{locale}/{file}.json` into `messages/{locale}/{file}.json` with en key order
- `test-locales.ts` — Validate all locale files match en/ structure (missing keys, extra keys, structure)

## Temp directory layout

```
.agents/skills/sync-locales-from-en/temp/YYYY-MM-DD/
  blueprint/
    advisor.md                   # Human-readable advisor behavior snapshot for this run
    advisor.json                 # Machine-readable advisor contract
    executor-translation.md      # Human-readable executor translation rules
    executor-translation.json    # Machine-readable executor contract
  reference/
    missing-keys-report.json
    main.json                    # English values for missing keys (union across locales)
    ui.json
    model.json
  draft/
    de-001.json                  # Flat key::value chunks (max 50 keys each, never modified)
    de-002.json
    es-001.json
    fr-001.json
    zh-001.json
  translation/
    de-001.json                  # Copied from draft/, executor subagents write translations here
    de-002.json
    es-001.json                  # If an executor subagent is interrupted, this chunk persists
    fr-001.json
    zh-001.json
  final/
    de/main.json                 # Nested JSON, unflattened from translated files
    de/ui.json
    es/...
```

## Draft / Translation file format

Files are chunked: `draft/{locale}-{NNN}.json` and `translation/{locale}-{NNN}.json` (max 50 keys per chunk). Each chunk is a flat JSON object with `{file}::{dotpath}` keys:

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
- `temp/YYYY-MM-DD/draft/{locale}-{NNN}.json` — Flat JSON chunks with `{file}::{dotpath}` keys and English values (max 50 keys per chunk)

### Step 3: Generate blueprint/

The advisor must create `temp/YYYY-MM-DD/blueprint/` directly and write the run-scoped advisor/executor contract files:

- `blueprint/advisor.md`
- `blueprint/advisor.json`
- `blueprint/executor-translation.md`
- `blueprint/executor-translation.json`

Write these files before any executor launch. If the current run is a resume of the same run context, reuse the existing files; otherwise rewrite all four so they match the current compare/extract output.

Advisor generation checklist:

- Create the `blueprint/` directory under the current `temp/YYYY-MM-DD/`.
- Derive the current run context from `reference/missing-keys-report.json`, the current sorted draft chunk filenames, the batch size, and the provider model defaults.
- Build `run_context_signature_input` as a canonical JSON object with:
  - `batch_size`
  - `model_defaults`
  - `draft_chunk_files` as a sorted array
  - `compare_report` as the sorted `missing-keys-report.json` content, normalized to `locale`, `file`, and `missingKeys`
- Build `run_context_signature` from that canonical object. If hashing is easy in the runtime, use a deterministic hash of the canonical JSON string. If hashing is not available, store the canonical JSON string itself as the signature.
- Reuse an existing blueprint only if both `run_context_signature` and `run_context_signature_input` match exactly.
- Set `max_parallel_executors` for this run:
  - Default to `4`
  - If the runtime clearly exposes fewer safe worker slots, lower it accordingly
  - Never set it to `0`
- Write `advisor.md` as a concise human-readable summary of the current run: goal, ordered steps, directories, model defaults, locale/chunk counts, and retry guidance.
- Write `advisor.json` as the machine contract for this run, including:
  - `contract_version`
  - `goal`
  - `run_context_signature`
  - `run_context_signature_input`
  - `max_parallel_executors`
  - `directories`
  - `workflow.ordered_steps`
  - `model_defaults`
  - `locale_summaries`
  - `chunk_registry`
  - `retry_policy`
  - `executor_contract_refs`
- Write `executor-translation.md` as the human-readable translation contract executors should follow.
- Write `executor-translation.json` as the machine contract executors should follow, including:
  - `contract_version`
  - `role`
  - `task`
  - `input_schema`
  - `invariants`
  - `output_schema`
  - `task_envelope_example`
- Use file refs in the JSON contract so executors can read blueprint files instead of receiving duplicated prompt text.
- Initialize `chunk_registry` for a new run with one entry per chunk file:
  - `chunk_file`
  - `locale`
  - `translation_file_ref`
  - `status`: `pending`
  - `attempt_count`: `0`
  - `model_used`: `null`
  - `last_result_notes`: `[]`
- On a true resume, reuse the existing `chunk_registry`. If a chunk exists in `draft/` or `translation/` but is missing from the registry, reconstruct it from file state:
  - if `translation/{chunk}` is byte-identical to `draft/{chunk}`, reconstruct it as `pending`
  - if the translation file has the same key set but different values, reconstruct it as `ok` candidate, run a quick sanity check, and then keep it `ok` or downgrade it to `retry_needed`
  - if the translation file has missing/extra/reordered keys or invalid JSON, reconstruct it as `retry_needed`

### Step 4: Prepare translation/

Before running `pnpm i18n:copy-draft`, decide whether this is a true resume or a new same-date run:

- If `run_context_signature` matches the existing blueprint exactly, this is a true resume. Preserve existing `translation/` and `final/` artifacts for this date.
- If `run_context_signature` does not match, this is a new same-date run. Invalidate stale derived artifacts before continuing:
  - Delete all files under `translation/` for the current date
  - Delete all files under `final/` for the current date
  - Keep `reference/` and `draft/` from the current compare/extract run
  - Rewrite all blueprint files for the new signature
  - Reinitialize `chunk_registry` so every current chunk starts as `pending`

Then run `pnpm i18n:copy-draft` to copy `draft/{locale}-{NNN}.json` → `translation/{locale}-{NNN}.json`. Chunks already in `translation/` are skipped only for a true resume with a matching run-context signature.

### Step 5: Translate (executor subagents)

Keep the orchestrator on the configured advisor model from `blueprint/advisor.json`.

Launch executors through a bounded queue using `max_parallel_executors` from `blueprint/advisor.json`. Do not launch every chunk at once.

Runtime-specific execution rules:

- Codex/OpenAI with explicit delegation permission: launch each executor chunk with `spawn_agent`, assign exactly one `translation/{locale}-{NNN}.json` file per worker, and keep write ownership disjoint.
- Codex/OpenAI without explicit delegation permission: process the same queue locally in the advisor/main agent, one chunk at a time, and do not abandon Step 5 just because no subagent was launched.
- Claude/Cursor-style runtimes with an agent tool: use the bounded executor queue normally.
- In every runtime, update `chunk_registry` in `blueprint/advisor.json` immediately when a chunk becomes `running`, `ok`, `retry_needed`, `failed`, or `timed_out`.

Executor model examples:
- GPT executor: `model: "gpt-5.4-mini"` with `reasoning.effort: "none"` by default, optionally `"low"` for difficult chunks
- Claude executor: `model: "claude-sonnet-4-6"` with `thinking: { type: "adaptive" }` and `effort: "low"`

Each executor subagent translates one chunk file at `temp/YYYY-MM-DD/translation/{locale}-{NNN}.json`.

Each executor subagent should receive the executor blueprint refs plus a minimal JSON task envelope. Example:

```json
{
  "role": "executor",
  "task": "translate_chunk",
  "locale": "{locale}",
  "language": "{language}",
  "translation_file_ref": ".agents/skills/sync-locales-from-en/temp/YYYY-MM-DD/translation/{locale}-{NNN}.json",
  "blueprint_refs": [
    ".agents/skills/sync-locales-from-en/temp/YYYY-MM-DD/blueprint/executor-translation.md",
    ".agents/skills/sync-locales-from-en/temp/YYYY-MM-DD/blueprint/executor-translation.json"
  ],
  "output_schema": {
    "status": "ok | retry_needed | failed",
    "locale": "{locale}",
    "chunk_file": "{locale}-{NNN}.json",
    "notes": []
  }
}
```

If the runtime only accepts a plain-text prompt, embed the same JSON envelope verbatim and point to the blueprint refs. Do not repeat the full translation rules inline for every executor unless you have no other option.

Executor monitoring and retry rules:

- Track every chunk in an advisor-side registry with:
  - `chunk_file`
  - `locale`
  - `status`: `pending | running | ok | retry_needed | failed | timed_out`
  - `attempt_count`
  - `model_used`
  - `launch_time`
  - `last_update_time`
- Build the initial pending queue from `chunk_registry`:
  - enqueue chunks with status `pending`, `retry_needed`, `failed`, or `timed_out`
  - on a resumed run, convert any stale `running` entries from the previous attempt into `timed_out` and enqueue them
  - do not enqueue chunks whose status is already `ok`
- Preserve `ok` chunks on a true resume. Do not relaunch executors for them and do not overwrite their existing translation files.
- Keep at most `max_parallel_executors` active executors at any time.
- When one executor finishes, immediately update its registry entry in memory and in `blueprint/advisor.json`, then launch the next pending chunk if any remain.
- Poll executor results with bounded waits. Do not block indefinitely on `TaskOutput`.
- Poll at least every 30 to 60 seconds while any chunk is `running`.
- If an executor does not reach a final status within 5 minutes of launch, mark that attempt `timed_out`.
- When a chunk attempt times out or returns `retry_needed`, immediately relaunch a replacement executor for that single chunk instead of waiting for all other chunks to finish first.
- Local advisor fallback uses the same status transitions as subagents. A locally translated chunk still must be marked `running` before work begins and then `ok`, `retry_needed`, or `failed` after verification.
- Retry ladder for a single chunk:
  - Attempt 1: default executor model
  - Attempt 2: same executor model with stronger reasoning if available
    - GPT: raise `reasoning.effort` from `"none"` to `"low"`
    - Claude: keep `claude-sonnet-4-6` and retry once with the same contract
  - Attempt 3: escalate that one chunk to the advisor-tier model
    - GPT: `gpt-5.4` with `reasoning.effort: "low"`
    - Claude: `claude-opus-4-6` with adaptive thinking and `effort: "medium"`
- If a chunk still fails after 3 total attempts, mark it `failed`, include the reason in the advisor summary, and stop before Step 6.
- Do not run `unflatten`, `merge`, or `test` unless every chunk is `ok`.
- At the end of Step 5, report:
  - chunks succeeded
  - chunks skipped because they were already `ok` on resume
  - chunks retried
  - chunks failed
  - chunks that require manual follow-up

Language mapping (locale → language name):
- de → German, es → Spanish, fr → French, zh → Simplified Chinese
- ar → Arabic, cn → Simplified Chinese, id → Indonesian, it → Italian
- ja → Japanese, ko → Korean, pt → Portuguese, ru → Russian
- th → Thai, tw → Traditional Chinese, vi → Vietnamese
- For unknown locales, use the locale code as the language name

### Step 6: Unflatten

Run `pnpm i18n:unflatten` to merge translated `translation/{locale}-{NNN}.json` chunks per locale, then convert into nested JSON at `final/{locale}/{file}.json`.

### Step 7: Merge

Run `pnpm i18n:merge` to merge translated files from `temp/YYYY-MM-DD/final/{locale}/{file}.json` into `messages/{locale}/{file}.json`. Existing translations are preserved; new keys are added. Key order follows en/{file}.json.

### Step 8: Test

Run `pnpm i18n:test` to validate all locale files match en/ structure.

Report summary: which locales succeeded, which failed, which chunks were retried, and which need manual retry.

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
- LLM executor subagents replace Google Translate
- Parallel executor subagents per locale for speed
- Batch keys (25 per prompt cycle) to reduce token overhead
- `messages/en/` as sole base

### v2 (current)
- Flat JSON format: `{file}::{dotpath}` keys for safer LLM translation
- No nested JSON during translation — eliminates broken JSON structure risk
- Token-efficient: flat key-value pairs instead of nested JSON
- Run-scoped blueprint snapshots in `temp/YYYY-MM-DD/blueprint/`
- Structured executor task envelopes with file refs instead of large repeated prompts
- Draft/translation split: `draft/` stays pristine, `translation/` is the working copy
- Interrupted subagents can be resumed — `translation/{locale}-{NNN}.json` persists
- New `unflatten` step converts translated flat files back to nested JSON
- Provider-agnostic advisor/executor model split across GPT and Claude families
- Batch chunking (batchSize: 50): large locales split into `{locale}-001.json`, `{locale}-002.json`, etc.
  - One executor subagent per chunk — prevents Write tool truncation on large key sets
  - Chunks merge automatically during unflatten step
