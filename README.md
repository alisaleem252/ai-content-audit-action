# AI Content Audit (GitHub Action)

![GitHub Action](https://img.shields.io/badge/GitHub-Action-2088FF) ![Dependencies](https://img.shields.io/badge/dependencies-0-blue) ![Powered by RapidTextAI](https://img.shields.io/badge/powered%20by-RapidTextAI-4f46e5)

A quality gate for content repos. When a pull request changes Markdown posts, this action **fact-checks them against live sources and spot-checks them for copied text**, posts a report on the pull request, and can block the merge if a post falls below your thresholds.

Built for blogs, docs sites and knowledge bases kept in Git: Hugo, Jekyll, Next.js, Astro, Docusaurus, MkDocs and plain Markdown folders. Powered by your own [RapidTextAI](https://app.rapidtextai.com) API key.

## Why use it

- **Catch wrong claims before readers do.** Each post's checkable claims are verified against live search evidence, and the report quotes the source for any claim that is contradicted or only partly supported.
- **Catch copied text.** Distinctive sentences are searched as exact phrases and flagged when 8+ consecutive words match another page.
- **Reviewers get facts, not vibes.** One comment on the pull request, updated on every push, with a table of scores and expandable details.
- **Cost stays predictable.** Only changed files are audited, at most `max-files` per run (default 3), and short files are skipped. Cost per file is 9 request units (6 fact check + 3 originality).
- **Zero dependencies.** A single Node 20 action with no build step and nothing to vendor.

## Quick start

1. Add your RapidTextAI API key as a repository secret named `RAPIDTEXTAI_API_KEY`.
2. Add `.github/workflows/content-audit.yml`:

```yaml
name: Content audit
on:
  pull_request:
    paths: ['**/*.md', '**/*.mdx']

permissions:
  contents: read
  pull-requests: write   # lets the action post and update its report comment

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: alisaleem252/ai-content-audit-action@v1
        with:
          api-key: ${{ secrets.RAPIDTEXTAI_API_KEY }}
```

That's all. Open a pull request that edits a post and the report appears as a comment.

> Pull requests from forks can't read secrets, so the action skips itself with a warning instead of failing.

## What the report looks like

| File | Fact check | Originality | Result |
|---|---|---|---|
| `posts/remote-budgeting.md` | 85/100 | 96/100 | ✅ passed |
| `posts/cloud-costs.md` | 55/100 | 91/100 | ❌ needs work |

Under each file, an expandable section lists the claims to review (with the quoted evidence and source link) and any overlapping text.

*(Illustrative example of the format.)*

## Inputs

| Input | Default | Description |
|---|---|---|
| `api-key` | required | RapidTextAI API key (use a secret) |
| `paths` | `**/*.md,**/*.mdx` | Globs of files to audit |
| `exclude` | `node_modules/**,README.md,CHANGELOG.md,**/README.md` | Globs to skip |
| `checks` | `fact-check,originality` | Which checks to run |
| `min-fact-score` | `70` | Minimum fact-check score (0-100) |
| `min-originality-score` | `80` | Minimum originality score (0-100) |
| `allow-contradicted` | `false` | Don't fail when a claim is contradicted |
| `max-files` | `3` | Files audited per run; the rest are listed as skipped |
| `min-words` | `150` | Skip files shorter than this |
| `fail-on-threshold` | `true` | Fail the job when a file is below a threshold |
| `comment` | `true` | Post and update the pull request comment |
| `github-token` | `${{ github.token }}` | Token for listing files and commenting |
| `base-url` | RapidTextAI default | API base URL override |

### Outputs

`status` (`passed`, `failed` or `skipped`), `files-audited`, `units-used`.

### Examples

Report only, never block:

```yaml
      - uses: alisaleem252/ai-content-audit-action@v1
        with:
          api-key: ${{ secrets.RAPIDTEXTAI_API_KEY }}
          fail-on-threshold: 'false'
```

Only audit the blog, originality only, stricter threshold:

```yaml
      - uses: alisaleem252/ai-content-audit-action@v1
        with:
          api-key: ${{ secrets.RAPIDTEXTAI_API_KEY }}
          paths: 'content/blog/**/*.md'
          checks: originality
          min-originality-score: '90'
```

## How it works

1. Lists the files changed in the pull request and keeps the ones matching `paths` and not `exclude`.
2. Strips front matter, code blocks, HTML comments and bare image lines, so only prose is checked.
3. Sends each file's text to RapidTextAI (fact check, then originality). Files are processed one at a time because RapidTextAI runs one job per account at once.
4. Writes a job summary, updates the pull request comment, sets outputs, and fails the job if a threshold is missed.

A file whose audit errors out (for example a temporary API problem) is shown as ⚠️ and fails the run, so problems are never hidden. Units for a failed request are refunded by the API.

## Good to know

- **Spot checks, not guarantees.** Fact check examines up to 10 claims per file and originality samples distinctive sentences. Treat results as a prompt for human review.
- **Needs web search on the RapidTextAI server.** Otherwise the checks return 503.
- **Public information only.** Claims are checked against public web results, so product-internal or very new facts may come back "unverified".

## Development

```bash
npm test      # offline tests, including an end-to-end run against fake GitHub and RapidTextAI servers (Node 20+)
```

To publish a release, tag it (`git tag v1.0.0 && git push --tags`) and also move the major tag (`git tag -f v1 && git push -f origin v1`) so `@v1` works.

## License

No license has been chosen yet; add one before accepting contributions.
