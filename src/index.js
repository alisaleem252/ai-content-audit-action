import { readFile, appendFile } from 'node:fs/promises';
import { RapidTextAI } from './api.js';
import { GitHub } from './github.js';
import { auditFiles, overall, estimate } from './audit.js';
import { buildReport } from './report.js';
import { list, matchesAny } from './util.js';

// The Actions runner exposes inputs as INPUT_<NAME> with spaces turned into underscores and hyphens kept.
const input = (name, def = '') => {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  return (process.env[key] ?? process.env[key.replace(/-/g, '_')])?.trim() || def;
};
const bool = (v) => String(v).toLowerCase() === 'true';
const notice = (m) => console.log(`::notice::${m}`);
const warn = (m) => console.log(`::warning::${m}`);
const setOutput = (k, v) => process.env.GITHUB_OUTPUT && appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

async function main() {
  const apiKey = input('api-key');
  if (!apiKey) {
    // Secrets are not available to pull requests from forks.
    warn('No RapidTextAI API key was provided (pull requests from forks cannot read secrets). Skipping the audit.');
    await setOutput('status', 'skipped');
    return;
  }
  console.log(`::add-mask::${apiKey}`);

  const o = {
    checks: list(input('checks', 'fact-check,originality')).filter((c) => ['fact-check', 'originality'].includes(c)),
    minFact: Number(input('min-fact-score', '70')), minOriginality: Number(input('min-originality-score', '80')),
    allowContradicted: bool(input('allow-contradicted', 'false')), maxFiles: Math.max(1, Number(input('max-files', '3'))),
    minWords: Number(input('min-words', '150')),
  };
  if (!o.checks.length) throw new Error('`checks` must include fact-check and/or originality.');

  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH || '/dev/null', 'utf8').catch(() => '{}'));
  const number = event.pull_request?.number;
  if (!number) { notice('Not a pull request event; nothing to audit.'); await setOutput('status', 'skipped'); return; }

  const gh = new GitHub({ token: input('github-token'), repo: process.env.GITHUB_REPOSITORY });
  const include = list(input('paths', '**/*.md,**/*.mdx')), exclude = list(input('exclude', 'node_modules/**,README.md,CHANGELOG.md,**/README.md'));
  const files = (await gh.changedFiles(number)).filter((f) => matchesAny(f, include) && !matchesAny(f, exclude));
  console.log(`${files.length} Markdown file(s) changed; auditing up to ${o.maxFiles} (about ${estimate(Math.min(files.length, o.maxFiles), o.checks)} units).`);

  const client = new RapidTextAI({ apiKey, baseUrl: input('base-url') || undefined });
  const outcome = await auditFiles(client, files, o, { workspace: process.env.GITHUB_WORKSPACE || process.cwd(), log: (m) => console.log(m) });
  const status = overall(outcome.results);
  const report = buildReport(outcome, o);

  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  if (bool(input('comment', 'true'))) {
    try { await gh.upsertComment(number, report); } catch (e) { warn(`Could not post the PR comment (does the workflow have "pull-requests: write"?): ${e.message}`); }
  }
  await setOutput('status', status);
  await setOutput('files-audited', outcome.results.length);
  await setOutput('units-used', outcome.units);

  if (status === 'failed' && bool(input('fail-on-threshold', 'true'))) {
    console.log('::error::AI Content Audit found content below your thresholds. See the report on the pull request.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.log(`::error::${e.message}`); process.exitCode = 1; });
