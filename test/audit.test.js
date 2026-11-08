import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { globToRegExp, matchesAny, stripFrontMatter, contentOf, list, wordCount } from '../src/util.js';
import { auditFiles, judge, overall, estimate } from '../src/audit.js';
import { buildReport } from '../src/report.js';
import { GitHub, MARKER } from '../src/github.js';

const O = { checks: ['fact-check', 'originality'], minFact: 70, minOriginality: 80, allowContradicted: false, maxFiles: 2, minWords: 5 };
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('globs', () => {
  assert.ok(globToRegExp('**/*.md').test('docs/a/b.md'));
  assert.ok(globToRegExp('**/*.md').test('a.md'));
  assert.ok(!globToRegExp('*.md').test('docs/a.md'));
  assert.ok(globToRegExp('docs/**').test('docs/x/y.txt'));
  assert.ok(matchesAny('node_modules/x/readme.md', ['node_modules/**']));
  assert.ok(!globToRegExp('**/*.md').test('a.mdx'));
  assert.deepEqual(list('a, b\nc,, '), ['a', 'b', 'c']);
});

test('markdown cleaning drops front matter, code and comments', () => {
  const md = '---\ntitle: X\ndraft: false\n---\n# Hello\n\n```js\nconst a = 1;\n```\n<!-- note -->\n![img](a.png)\nReal text here.\n';
  const c = contentOf(md);
  assert.ok(!c.includes('title:') && !c.includes('const a') && !c.includes('note') && !c.includes('img'));
  assert.match(c, /Hello[\s\S]*Real text here/);
  assert.equal(stripFrontMatter('no front matter'), 'no front matter');
  assert.equal(wordCount('a b  c'), 3);
});

test('judge and overall', () => {
  const fc = (score, contradicted = 0) => ({ summary: { score, contradicted } });
  assert.deepEqual(judge({ factCheck: fc(90), originality: { score: 90 } }, O), []);
  assert.equal(judge({ factCheck: fc(50, 1), originality: { score: 60 } }, O).length, 3);
  assert.equal(overall([]), 'skipped');
  assert.equal(overall([{ reasons: [] }]), 'passed');
  assert.equal(overall([{ reasons: [], error: 'x' }]), 'failed');
  assert.equal(estimate(2, ['fact-check', 'originality']), 18);
});

test('auditFiles: limits, skips short files, isolates errors, sends text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aud-'));
  for (const [f, body] of [['a.md', words(50)], ['b.md', words(50)], ['c.md', words(50)], ['short.md', 'tiny']]) await writeFile(join(dir, f), body);
  const calls = [];
  const client = { async seo(tool, body) { calls.push([tool, body]); if (body.text.startsWith('word0') && calls.length > 2) throw new Error('boom'); return tool === 'originality' ? { score: 95, matches: [] } : { summary: { score: 90, contradicted: 0 }, claims: [] }; } };
  const r = await auditFiles(client, ['short.md', 'a.md', 'b.md', 'c.md'], { ...O, maxFiles: 3 }, { workspace: dir });
  assert.equal(r.results.length, 2);
  assert.deepEqual(r.skipped.map((s) => s.file).sort(), ['c.md', 'short.md']);
  assert.equal(r.results[0].reasons.length, 0);
  assert.equal(r.results[1].error, 'boom');
  assert.equal(r.units, 9, 'a call that errors is not counted (the API refunds it)');
  assert.equal(overall(r.results), 'failed');
  assert.ok(typeof calls[0][1].text === 'string' && !('html' in calls[0][1]));
});

test('report renders table, details and skipped files', () => {
  const results = [{ file: 'a.md', words: 100, error: null, reasons: ['fact-check score 40 < 70'], factCheck: { summary: { score: 40 }, claims: [{ claim: 'C', verdict: 'contradicted', evidence: 'E', source_url: 'https://x.y' }] }, originality: { score: 90, matches: [] } }];
  const md = buildReport({ results, skipped: [{ file: 'z.md', reason: 'under 150 words' }], units: 9 }, O);
  assert.match(md, /\| `a\.md` \| 40\/100 \| 90\/100 \| ❌ needs work \|/);
  assert.match(md, /<details>[\s\S]*contradicted[\s\S]*Skipped:.*z\.md/);
  assert.match(buildReport({ results: [], skipped: [], units: 0 }, O), /No Markdown files/);
});

test('GitHub client: paginates changed files and upserts one comment', async () => {
  const seen = []; let comments = [];
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      const j = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url.startsWith('/repos/o/r/pulls/7/files')) return j(req.url.includes('page=1') ? [{ filename: 'a.md', status: 'added' }, { filename: 'gone.md', status: 'removed' }] : []);
      if (req.method === 'GET' && req.url.includes('/issues/7/comments')) return j(comments);
      if (req.method === 'POST') { comments = [{ id: 1, body: JSON.parse(b).body }]; return j({ id: 1 }); }
      if (req.method === 'PATCH') { comments[0].body = JSON.parse(b).body; return j({ id: 1 }); }
    });
  }).listen(0);
  const gh = new GitHub({ token: 't', repo: 'o/r', apiUrl: `http://127.0.0.1:${srv.address().port}` });
  assert.deepEqual(await gh.changedFiles(7), ['a.md']);
  await gh.upsertComment(7, 'first');
  await gh.upsertComment(7, 'second');
  assert.equal(seen.filter((s) => s.startsWith('POST')).length, 1);
  assert.equal(seen.filter((s) => s.startsWith('PATCH')).length, 1);
  assert.ok(comments[0].body.startsWith(MARKER) && comments[0].body.includes('second'));
  srv.close();
});

test('end to end: runs index.js like the Actions runner does', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  await writeFile(join(dir, 'post.md'), `---\ntitle: t\n---\n${words(200)}`);
  await mkdir(join(dir, 'node_modules'));
  const event = join(dir, 'event.json'), out = join(dir, 'out.txt'), summary = join(dir, 'sum.md');
  await writeFile(event, JSON.stringify({ pull_request: { number: 7 } }));
  let comment = null;
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const j = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url.includes('/pulls/7/files')) return j([{ filename: 'post.md', status: 'modified' }, { filename: 'node_modules/x.md', status: 'added' }, { filename: 'src.js', status: 'added' }]);
      if (req.url.includes('/issues/7/comments')) { if (req.method === 'POST') comment = JSON.parse(b).body; return j([]); }
      if (req.url.includes('/v2/seo/')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const data = req.url.includes('fact-check') ? { summary: { score: 95, contradicted: 0 }, claims: [] } : { score: 92, matches: [] };
        res.write(`data: ${JSON.stringify({ type: 'result', data })}\n\n`); return res.end('data: [DONE]\n\n');
      }
      res.writeHead(404); res.end();
    });
  }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const env = { PATH: process.env.PATH, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: base, GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, 'INPUT_API-KEY': 'secret', 'INPUT_GITHUB-TOKEN': 'tok', 'INPUT_BASE-URL': `${base}/openai`, 'INPUT_MIN-WORDS': '50' };
  // Real runner format: INPUT_<UPPERCASED NAME> with hyphens kept.
  let log = '';
  const code = await new Promise((r) => { const p = spawn(process.execPath, ['src/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d)); p.on('exit', r); });
  if (code !== 0) console.error(log);
  srv.close();
  assert.equal(code, 0);
  const outputs = await readFile(out, 'utf8');
  assert.match(outputs, /status=passed/);
  assert.match(outputs, /files-audited=1/);
  assert.match(outputs, /units-used=9/);
  assert.match(comment, /ai-content-audit[\s\S]*post\.md[\s\S]*95\/100/);
  assert.match(await readFile(summary, 'utf8'), /AI Content Audit/);
});
