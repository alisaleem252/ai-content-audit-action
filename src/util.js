/** Comma- or newline-separated list -> trimmed non-empty array. */
export const list = (s) => String(s || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/** Convert a glob (**, *, ?) to a RegExp that matches a repo-relative posix path. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matchesAny = (path, globs) => globs.some((g) => globToRegExp(g).test(path));

/** Remove YAML/TOML front matter, so metadata isn't fact-checked. */
export function stripFrontMatter(md) {
  return md.replace(/^﻿?(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/, '');
}

/** Markdown to the text worth checking: no front matter, code blocks, HTML comments or bare image lines. */
export function contentOf(md) {
  return stripFrontMatter(md)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*!\[[^\]]*\]\([^)]*\)\s*$/gm, '')
    .trim();
}

export const wordCount = (s) => (s.match(/\S+/g) || []).length;
