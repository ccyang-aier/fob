import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root, '.spec/source-baseline.json'), 'utf8'));
const adaptationsPath = path.join(root, '.spec/source-adaptations.json');
const adaptations = fs.existsSync(adaptationsPath) ? JSON.parse(fs.readFileSync(adaptationsPath, 'utf8')) : {};
const issues = [];
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = (value, kind) => kind === 'binary' ? value : value.toString('utf8').replace(/\r\n?/g, '\n');
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? files(target) : [target];
});

for (const entry of baseline.files) {
  const file = path.join(root, entry.path);
  if (!fs.existsSync(file)) { issues.push(`Missing copied capability: ${entry.path}`); continue; }
  const adaptation = adaptations[entry.path];
  if (adaptation && (!adaptation.reason || !/^[a-f0-9]{64}$/.test(adaptation.sha256))) issues.push(`Invalid adaptation record: ${entry.path}`);
  if (digest(canonical(fs.readFileSync(file), entry.kind)) !== (adaptation?.sha256 ?? entry.sha256)) issues.push(`Unreviewed change to copied capability: ${entry.path}`);
}
for (const name of Object.keys(adaptations)) {
  if (!baseline.files.some(entry => entry.path === name)) issues.push(`Adaptation is outside the copied baseline: ${name}`);
}

for (const directory of ['src', 'shared/src', 'backend/server/src']) {
  for (const file of files(path.join(root, directory)).filter(file => /\.[cm]?tsx?$/.test(file) && !/\.test\./.test(file))) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    if (/@fouc\/|NEXT_PUBLIC_FOUC_|process\.env\.FOUC_|(?:\.\.\/)+fouc\//.test(text)) issues.push(`Sibling product dependency: ${relative}`);
    if (/https?:\/\/(?:127\.0\.0\.1|localhost):(?:3000|8710|8711)\b/.test(text)) issues.push(`Fouc default endpoint in runtime code: ${relative}`);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith('@tauri-apps/') || specifier.includes('backend/device')) issues.push(`Desktop dependency: ${relative} -> ${specifier}`);
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (relative.startsWith('src/') && specifier.startsWith('@fob/server/') && !typeOnly) issues.push(`Frontend runtime imports server internals: ${relative}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }).some(name => name.startsWith('@tauri-apps/'))) issues.push('Desktop package in Web manifest');
if (fs.existsSync(path.join(root, 'src-tauri')) || fs.existsSync(path.join(root, 'backend/device'))) issues.push('Desktop distribution directory is present');
const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
if (/backend\/device|\.\.\/fouc/.test(workspace)) issues.push('Workspace depends on device or sibling product');

if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Fob extraction verified: ${baseline.files.length} knowledge/companion files, ${Object.keys(adaptations).length} pinned Web adaptations; independent frontend/service/shared boundaries.`);
}
