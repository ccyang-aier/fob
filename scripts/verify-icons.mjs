import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const issues = [];
const libraries = /^(?:lucide-react|@fortawesome\/|@phosphor-icons\/|@iconify\/|@heroicons\/|@tabler\/icons|react-icons(?:\/|$)|@radix-ui\/react-icons)/;
const approved = new Set(['src/components/icons/index.ts', 'src/components/icons/solid-icon.tsx']);
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
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'svg') {
      issues.push(`${relative}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: handwritten UI SVG; choose an official catalog icon`);
    }
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'weight') issues.push(`${relative}: obsolete per-call icon weight; choose solid/outline in the catalog`);
    ts.forEachChild(node, visit);
  }
  visit(tree);
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
} else console.log(`Icon policy verified: ${sources.length} source files; FA7 Solid + cataloged Lucide controls; no handwritten UI SVGs or legacy icon imports.`);
