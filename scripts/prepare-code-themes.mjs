/** Scope the installed Highlight.js themes to each document block. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import postcss from 'postcss';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('highlight.js/package.json'));
const themes = { light: 'github', dark: 'github-dark', paper: 'stackoverflow-light', monokai: 'monokai', idea: 'idea', darcula: 'base16/darcula', nord: 'nord', 'one-dark': 'atom-one-dark' };
const license = await readFile(join(source, 'LICENSE'), 'utf8');
const css = ['/* Generated from Highlight.js styles by scripts/prepare-code-themes.mjs. Upstream copyright and theme credits retained.\n' + license + '\n*/'];
for (const [id, filename] of Object.entries(themes)) {
  const root = postcss.parse(await readFile(join(source, 'styles', `${filename}.css`), 'utf8'));
  const scope = `.fob-code-theme[data-code-theme="${id}"]`;
  root.walkRules(rule => {
    if (rule.selector.includes('code.hljs')) { rule.remove(); return; }
    if (rule.selector === '.hljs') {
      const values = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
      rule.removeAll();
      rule.append({ prop: '--code-bg', value: values.background ?? '#fff' }, { prop: '--code-ink', value: values.color ?? '#24292e' });
      rule.selector = scope;
    } else rule.selector = rule.selectors.map(selector => `${scope} ${selector}`).join(',\n');
  });
  css.push(root.toString());
}
await writeFile(new URL('../src/features/knowledge/editor/block-modules/code-block/code-themes.css', import.meta.url), css.join('\n'));
