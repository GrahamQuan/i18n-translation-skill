#!/usr/bin/env bash
set -euo pipefail

# Setup script for sync-locales-from-en i18n translation skill
# 1. Adds i18n scripts to the target project's package.json
# 2. Updates .gitignore with temp file exclusions
# 3. Installs tsx and @types/node as devDependencies

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

echo "=== sync-locales-from-en setup ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# ─── 1. Update package.json scripts ───────────────────────────────────────────

PACKAGE_JSON="$PROJECT_ROOT/package.json"

if [ ! -f "$PACKAGE_JSON" ]; then
  echo "ERROR: No package.json found at $PACKAGE_JSON"
  echo "Please run this script from a project that has a package.json."
  exit 1
fi

echo "1) Updating package.json scripts..."

# The i18n scripts to add
declare -A I18N_SCRIPTS
I18N_SCRIPTS=(
  ["i18n:compare"]="tsx .agents/skills/sync-locales-from-en/scripts/compare-locales.ts"
  ["i18n:extract"]="tsx .agents/skills/sync-locales-from-en/scripts/extract-locales.ts"
  ["i18n:copy-draft"]="tsx .agents/skills/sync-locales-from-en/scripts/copy-locales-draft.ts"
  ["i18n:translate"]="echo 'You should use LLM to translate the files in .agents/skills/sync-locales-from-en/temp/yyyy-mm-dd/translation'"
  ["i18n:unflatten"]="tsx .agents/skills/sync-locales-from-en/scripts/unflatten-translations.ts"
  ["i18n:merge"]="tsx .agents/skills/sync-locales-from-en/scripts/merge-translations.ts"
  ["i18n:test"]="tsx .agents/skills/sync-locales-from-en/scripts/test-locales.ts"
)

# Use node to safely modify package.json (preserves formatting)
node -e "
const fs = require('fs');
const pkgPath = '$PACKAGE_JSON';
const raw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);

if (!pkg.scripts) {
  pkg.scripts = {};
}

// Scripts to add (appended at the end)
const newScripts = {
  'i18n:compare': 'tsx .agents/skills/sync-locales-from-en/scripts/compare-locales.ts',
  'i18n:extract': 'tsx .agents/skills/sync-locales-from-en/scripts/extract-locales.ts',
  'i18n:copy-draft': 'tsx .agents/skills/sync-locales-from-en/scripts/copy-locales-draft.ts',
  'i18n:translate': \"echo 'You should use LLM to translate the files in .agents/skills/sync-locales-from-en/temp/yyyy-mm-dd/translation'\",
  'i18n:unflatten': 'tsx .agents/skills/sync-locales-from-en/scripts/unflatten-translations.ts',
  'i18n:merge': 'tsx .agents/skills/sync-locales-from-en/scripts/merge-translations.ts',
  'i18n:test': 'tsx .agents/skills/sync-locales-from-en/scripts/test-locales.ts'
};

// Remove any existing i18n scripts first to avoid duplicates
const existingScripts = {};
for (const [key, value] of Object.entries(pkg.scripts)) {
  if (!key.startsWith('i18n:')) {
    existingScripts[key] = value;
  }
}

// Append new scripts at the end
pkg.scripts = { ...existingScripts, ...newScripts };

// Detect indent from original file
const indentMatch = raw.match(/^(\s+)\"/m);
const indent = indentMatch ? indentMatch[1].length : 2;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + '\n');
console.log('  Added i18n scripts to package.json (appended to end of scripts)');
"

echo ""

# ─── 2. Update .gitignore ─────────────────────────────────────────────────────

GITIGNORE="$PROJECT_ROOT/.gitignore"

echo "2) Updating .gitignore..."

IGNORE_COMMENT="# i18n translation temp files"
IGNORE_LINE=".agents/skills/sync-locales-from-en/temp/"
LEGACY_IGNORE_LINE=".claude/skills/sync-locales-from-en/temp/"

# Create .gitignore if it doesn't exist
if [ ! -f "$GITIGNORE" ]; then
  touch "$GITIGNORE"
  echo "  Created .gitignore"
fi

# Remove the legacy Claude-only ignore entry if present
if grep -qF "$LEGACY_IGNORE_LINE" "$GITIGNORE"; then
  node -e "
const fs = require('fs');
const gitignorePath = '$GITIGNORE';
const legacyLine = '$LEGACY_IGNORE_LINE';
const lines = fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/);
const filtered = lines.filter((line) => line !== legacyLine);
fs.writeFileSync(gitignorePath, filtered.join('\n').replace(/\n*$/, '\n'));
"
  echo "  Removed legacy Claude temp exclusion from .gitignore"
fi

# Check if the canonical entry already exists
if ! grep -qF "$IGNORE_LINE" "$GITIGNORE"; then
  # Ensure file ends with newline before appending
  if [ -s "$GITIGNORE" ] && [ "$(tail -c 1 "$GITIGNORE")" != "" ]; then
    echo "" >> "$GITIGNORE"
  fi

  {
    echo ""
    echo "$IGNORE_COMMENT"
    echo "$IGNORE_LINE"
  } >> "$GITIGNORE"

  echo "  Added i18n temp file exclusion to .gitignore"
else
  echo "  .gitignore already contains the canonical i18n temp file exclusion (skipped)"
fi

echo ""

# ─── 3. Install devDependencies ───────────────────────────────────────────────

echo "3) Installing tsx and @types/node as devDependencies..."

cd "$PROJECT_ROOT"

# Detect package manager
if [ -f "pnpm-lock.yaml" ] || [ -f "pnpm-workspace.yaml" ]; then
  PM="pnpm"
elif [ -f "yarn.lock" ]; then
  PM="yarn"
elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
  PM="bun"
else
  PM="npm"
fi

echo "  Detected package manager: $PM"

case "$PM" in
  pnpm)
    pnpm add -D tsx @types/node 2>&1 && echo "  Installed successfully" || echo "  WARNING: Install failed. Please run: pnpm add -D tsx @types/node"
    ;;
  yarn)
    yarn add -D tsx @types/node 2>&1 && echo "  Installed successfully" || echo "  WARNING: Install failed. Please run: yarn add -D tsx @types/node"
    ;;
  bun)
    bun add -D tsx @types/node 2>&1 && echo "  Installed successfully" || echo "  WARNING: Install failed. Please run: bun add -D tsx @types/node"
    ;;
  npm)
    npm install -D tsx @types/node 2>&1 && echo "  Installed successfully" || echo "  WARNING: Install failed. Please run: npm install -D tsx @types/node"
    ;;
esac

echo ""
echo "=== Setup complete ==="
echo ""
echo "Available i18n scripts:"
echo "  $PM run i18n:compare    - Compare locale files with en/ to find missing keys"
echo "  $PM run i18n:extract    - Extract missing keys into translation chunks"
echo "  $PM run i18n:copy-draft - Copy draft translations for review"
echo "  $PM run i18n:translate  - (Use LLM to translate extracted chunks)"
echo "  $PM run i18n:unflatten  - Unflatten translated chunks back to nested JSON"
echo "  $PM run i18n:merge      - Merge translations back into locale files"
echo "  $PM run i18n:test       - Validate all locale files match en/ structure"
