import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const issues = [];
// Explicit user reference exceptions; file pins prevent unrelated custom geometry.
const retainedToggle = { path: 'src/components/icons/sidebar-toggle-icon.tsx', sha256: '3b669a42891104441972cade67bb74f017141b55c81b68726ea47f6e3a7f04ed' };
const generationReference = { path: 'src/components/icons/generate-star-icon.tsx', sha256: 'e9cf11ef8df2caedf23297dfbede39c65567cb209d4ff6a2d3947db4a9c82912' };
const pinnedGlyphs = [retainedToggle, generationReference];
const libraries = /^(?:lucide-react|@fortawesome\/|@phosphor-icons\/|@iconify\/|@heroicons\/|@tabler\/icons|react-icons(?:\/|$)|@radix-ui\/react-icons)/;
const approved = new Set(['src/components/icons/index.ts', 'src/components/icons/solid-icon.tsx']);
// Exact collection-page reference requested by the user; original BSD artwork only.
const outlineAssetRoot = path.join(root, 'public/icons/outline-collection');
const outlineAssets = JSON.parse(fs.readFileSync(path.join(outlineAssetRoot, 'sources.json'), 'utf8'));
const outlineNames = ['collection', 'document', 'team', 'checkmark', 'starred', 'unstarred', 'pin', 'archive', 'unpublish', 'trash', 'close'];
if (Object.keys(outlineAssets).sort().join() !== [...outlineNames].sort().join()) issues.push('Outline collection artwork is limited to the selected reference glyphs.');
for (const name of outlineNames) {
  const record = outlineAssets[name], bytes = fs.readFileSync(path.join(outlineAssetRoot, `${name}.svg`));
  if (!record?.source?.startsWith('https://raw.githubusercontent.com/outline/outline-icons/main/src/components/') || createHash('sha256').update(bytes).digest('hex') !== record.sha256) issues.push(`Original Outline collection artwork changed: ${name}`);
}
// User-approved emoji artwork is a separately pinned, bounded content catalog.
const emojiRoot = path.join(root, 'public/icons/openmoji');
const emojiManifest = JSON.parse(fs.readFileSync(path.join(emojiRoot, 'sources.json'), 'utf8'));
const emojiCatalog = JSON.parse(fs.readFileSync(path.join(root, 'src/components/icons/openmoji-catalog.json'), 'utf8'));
const emojiItems = emojiCatalog.flatMap(group => group.items);
const emojiCodes = new Set(emojiItems.map(item => item.hexcode));
if (emojiCatalog.length !== 8 || emojiCatalog.some(group => group.items.length !== 56) || emojiItems.length !== 448 || emojiCodes.size !== 448 || Object.keys(emojiManifest.icons).length !== 448 || emojiManifest.version !== '17.0.0' || emojiManifest.license !== 'CC-BY-SA-4.0') issues.push('OpenMoji is limited to the reviewed 448-emoji, eight-category subset.');
for (const item of emojiItems) {
  if (!/^[0-9A-F]+(?:-[0-9A-F]+)*$/.test(item.hexcode)) { issues.push('Invalid OpenMoji asset path'); continue; }
  const bytes = fs.readFileSync(path.join(emojiRoot, `${item.hexcode}.svg`));
  const record = emojiManifest.icons[item.hexcode];
  if (record?.source !== `https://raw.githubusercontent.com/hfg-gmuend/openmoji/17.0.0/color/svg/${item.hexcode}.svg` || record.emoji !== item.emoji || createHash('sha256').update(bytes).digest('hex') !== record.sha256) issues.push(`Original OpenMoji artwork changed: ${item.hexcode}`);
}
if (fs.readdirSync(emojiRoot).filter(file => file.endsWith('.svg')).some(file => !emojiCodes.has(file.slice(0, -4)))) issues.push('Unreviewed emoji SVG in the bounded OpenMoji directory.');
if (!fs.existsSync(path.join(root, 'public/licenses/openmoji.txt'))) issues.push('Retain the OpenMoji CC-BY-SA attribution and license.');
const sources = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter(file => /\.[cm]?tsx?$/.test(file) && !/\.test\./.test(file));

for (const file of sources) {
  const relative = `src/${file.replaceAll('\\', '/')}`;
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const node of tree.statements) {
    if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text;
    if (libraries.test(specifier) && !approved.has(relative)) issues.push(`${relative}: import icons through @/components/icons (${specifier})`);
    if (specifier.includes('phosphor') || (specifier.startsWith('@fortawesome/') && !/^@fortawesome\/(free-solid-svg-icons|fontawesome-svg-core|react-fontawesome)(?:\/|$)/.test(specifier))) {
      issues.push(`${relative}: icon library is outside FA7 Solid + approved Lucide controls (${specifier})`);
    }
  }
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'svg' && !pinnedGlyphs.some(glyph => glyph.path === relative)) {
      issues.push(`${relative}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: handwritten UI SVG; choose an official catalog icon`);
    }
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'weight') issues.push(`${relative}: obsolete per-call icon weight; choose solid/outline in the catalog`);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const glyph of pinnedGlyphs) {
    if (relative === glyph.path && createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('hex') !== glyph.sha256) issues.push(`User reference glyph changed: ${glyph.path}; the exception is limited to its pinned geometry.`);
  }
  if (source.includes('/assets/project-icons/')) issues.push(`${relative}: retired mixed-style icon artwork`);
}

for (const name of Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
  if (/phosphor|@iconify\/|@heroicons\/|@tabler\/icons|^react-icons$|@radix-ui\/react-icons/.test(name)) issues.push(`package.json: unapproved icon dependency ${name}`);
}
if (!/^7\./.test(packageJson.dependencies['@fortawesome/free-solid-svg-icons'] ?? '')) issues.push('package.json: pin the approved Font Awesome 7 Solid version');
const config = JSON.parse(fs.readFileSync(path.join(root, 'components.json'), 'utf8'));
if (config.iconLibrary !== 'lucide') issues.push('components.json: shadcn-generated outline controls must use Lucide, then route imports through the catalog');

if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else console.log(`Icon policy verified: ${sources.length} source files; FA7 Solid + cataloged Lucide controls; 448 pinned OpenMoji emoji; no unapproved SVGs or legacy icon imports.`);
