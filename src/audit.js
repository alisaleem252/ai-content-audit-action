import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contentOf, wordCount } from './util.js';

const UNITS = { 'fact-check': 6, originality: 3 };

export const estimate = (nFiles, checks) => nFiles * checks.reduce((n, c) => n + (UNITS[c] || 0), 0);

/** Decide a file's result against thresholds. */
export function judge({ factCheck, originality }, o) {
  const reasons = [];
  if (factCheck) {
    const s = factCheck.summary || {};
    if ((s.score ?? 0) < o.minFact) reasons.push(`fact-check score ${s.score ?? 0} < ${o.minFact}`);
    if (!o.allowContradicted && (s.contradicted ?? 0) > 0) reasons.push(`${s.contradicted} contradicted claim(s)`);
  }
  if (originality && (originality.score ?? 0) < o.minOriginality) reasons.push(`originality score ${originality.score ?? 0} < ${o.minOriginality}`);
  return reasons;
}

/**
 * Audit files one by one (RapidTextAI runs one job per account at a time).
 * Returns {results, skipped, units}. A file that errors is reported, not fatal to the others.
 */
export async function auditFiles(client, files, o, { workspace = process.cwd(), log = () => {}, signal } = {}) {
  const results = [], skipped = [];
  let units = 0;
  const batch = files.slice(0, o.maxFiles);
  for (const f of files.slice(o.maxFiles)) skipped.push({ file: f, reason: `over the max-files limit (${o.maxFiles})` });

  for (const file of batch) {
    let text;
    try { text = contentOf(await readFile(join(workspace, file), 'utf8')); } catch (e) { skipped.push({ file, reason: `could not read the file (${e.code || e.message})` }); continue; }
    if (wordCount(text) < o.minWords) { skipped.push({ file, reason: `under ${o.minWords} words` }); continue; }
    log(`Auditing ${file} (${wordCount(text)} words)`);
    const r = { file, words: wordCount(text), factCheck: null, originality: null, error: null, reasons: [] };
    try {
      if (o.checks.includes('fact-check')) { r.factCheck = await client.seo('fact-check', { text }, { signal }); units += UNITS['fact-check']; }
      if (o.checks.includes('originality')) { r.originality = await client.seo('originality', { text }, { signal }); units += UNITS.originality; }
      r.reasons = judge(r, o);
    } catch (e) {
      r.error = e.message;
    }
    results.push(r);
  }
  return { results, skipped, units };
}

export function overall(results) {
  if (!results.length) return 'skipped';
  return results.some((r) => r.error || r.reasons.length) ? 'failed' : 'passed';
}
