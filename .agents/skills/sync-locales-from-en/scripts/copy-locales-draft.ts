#!/usr/bin/env tsx
/**
 * Copy draft/ → translation/ for locales not yet in translation/.
 * Existing translation files are preserved (supports resuming interrupted runs).
 *
 * Usage: pnpm i18n:copy-draft
 */

/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';

import { DRAFT_DIR, TRANSLATION_DIR } from './helpers';

async function main() {
  console.log('📋 Copying draft files to translation/...\n');

  if (!fs.existsSync(DRAFT_DIR)) {
    console.error(`❌ Error: Draft directory not found: ${DRAFT_DIR}`);
    console.error('   Please run pnpm i18n:extract first');
    process.exit(1);
  }

  if (!fs.existsSync(TRANSLATION_DIR)) {
    fs.mkdirSync(TRANSLATION_DIR, { recursive: true });
  }

  const draftFiles = fs.readdirSync(DRAFT_DIR).filter((f) => f.endsWith('.json'));

  if (draftFiles.length === 0) {
    console.log('🎉 No draft files found. Nothing to copy.');
    return;
  }

  let copied = 0;
  let skipped = 0;

  draftFiles.forEach((file) => {
    const dest = path.join(TRANSLATION_DIR, file);
    if (fs.existsSync(dest)) {
      console.log(`⏭️  translation/${file}: already exists, skipped`);
      skipped++;
    } else {
      fs.copyFileSync(path.join(DRAFT_DIR, file), dest);
      console.log(`✅ translation/${file}: copied from draft`);
      copied++;
    }
  });

  console.log(`\n📊 Done: ${copied} copied, ${skipped} skipped`);
}

main().catch((error) => {
  console.error('\n❌ Copy failed:', error);
  process.exit(1);
});
