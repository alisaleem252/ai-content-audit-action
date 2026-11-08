const icon = (r) => (r.error ? '⚠️' : r.reasons.length ? '❌' : '✅');
const cell = (v) => (v === null || v === undefined ? '–' : String(v));

export function buildReport({ results, skipped, units }, o) {
  const lines = ['## AI Content Audit', ''];
  if (!results.length) {
    lines.push('No Markdown files needed auditing in this pull request.');
  } else {
    lines.push('| File | Fact check | Originality | Result |', '|---|---|---|---|');
    for (const r of results) {
      const f = r.factCheck?.summary;
      lines.push(`| \`${r.file}\` | ${f ? `${f.score}/100` : '–'} | ${r.originality ? `${r.originality.score}/100` : '–'} | ${icon(r)} ${r.error ? 'error' : r.reasons.length ? 'needs work' : 'passed'} |`);
    }
    for (const r of results) {
      const detail = [];
      if (r.error) detail.push(`- ⚠️ The audit could not run: ${r.error}`);
      for (const x of r.reasons) detail.push(`- ❌ ${x}`);
      for (const c of (r.factCheck?.claims || []).filter((c) => c.verdict === 'contradicted' || c.verdict === 'partly')) {
        detail.push(`- **${c.verdict}** claim: ${c.claim}${c.evidence ? `\n  > ${c.evidence}` : ''}${c.source_url ? `\n  ${c.source_url}` : ''}`);
      }
      for (const m of r.originality?.matches || []) detail.push(`- Overlap: "${m.sentence}" (${m.run_words} words shared with ${m.url})`);
      if (detail.length) lines.push('', `<details><summary><code>${r.file}</code></summary>`, '', ...detail, '', '</details>');
    }
  }
  if (skipped.length) lines.push('', '**Skipped:** ' + skipped.map((s) => `\`${s.file}\` (${s.reason})`).join(', '));
  lines.push('', `<sub>Thresholds: fact check ≥ ${o.minFact}, originality ≥ ${o.minOriginality} · ${units} RapidTextAI request units used · spot checks, review before publishing</sub>`);
  return lines.join('\n') + '\n';
}
