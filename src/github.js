export const MARKER = '<!-- ai-content-audit -->';

export class GitHub {
  constructor({ token, repo, apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com' }) {
    this.token = token; this.repo = repo; this.apiUrl = apiUrl.replace(/\/+$/, '');
  }

  async _req(method, path, body) {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'ai-content-audit-action' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  /** Files changed in a pull request (added/modified/renamed), across pages. */
  async changedFiles(number) {
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await this._req('GET', `/repos/${this.repo}/pulls/${number}/files?per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out.filter((f) => f.status !== 'removed').map((f) => f.filename);
  }

  /** Create the report comment, or update the one this action posted before. */
  async upsertComment(number, body) {
    const marked = `${MARKER}\n${body}`;
    for (let page = 1; page <= 10; page++) {
      const comments = await this._req('GET', `/repos/${this.repo}/issues/${number}/comments?per_page=100&page=${page}`);
      const mine = comments.find((c) => c.body?.includes(MARKER));
      if (mine) return this._req('PATCH', `/repos/${this.repo}/issues/comments/${mine.id}`, { body: marked });
      if (comments.length < 100) break;
    }
    return this._req('POST', `/repos/${this.repo}/issues/${number}/comments`, { body: marked });
  }
}
