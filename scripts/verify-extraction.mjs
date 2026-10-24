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
  const adaptation = adaptations[entry.path];
  if (adaptation?.deleted === true) {
    if (!adaptation.reason || adaptation.sha256) issues.push(`Invalid reviewed deletion: ${entry.path}`);
    if (fs.existsSync(file)) issues.push(`Deleted capability has been reintroduced: ${entry.path}`);
    continue;
  }
  if (!fs.existsSync(file)) { issues.push(`Missing copied capability: ${entry.path}`); continue; }
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
        if (/features\/project(?:\/|$)|@fob\/shared\/projects|modules\/projects(?:\/|$)/.test(specifier)) issues.push(`Separate project layer in knowledge product: ${relative} -> ${specifier}`);
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (relative.startsWith('src/') && specifier.startsWith('@fob/server/') && !typeOnly) issues.push(`Frontend runtime imports server internals: ${relative}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}

for (const obsolete of ['src/features/project', 'backend/server/src/modules/projects', 'shared/src/projects', 'backend/server/src/platform/database/resources/schema/projects.ts', 'backend/server/src/platform/database/resources/schema/knowledge-projects.ts', 'src/features/knowledge/knowledge-base-header.tsx']) {
  if (fs.existsSync(path.join(root, obsolete))) issues.push(`Obsolete duplicate workspace/navigation: ${obsolete}`);
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
  const removed = Object.values(adaptations).filter(value => value.deleted === true).length;
  console.log(`Fob extraction verified: ${baseline.files.length} source entries, ${baseline.files.length - removed} retained files, ${removed} reviewed obsolete deletions, ${Object.keys(adaptations).length - removed} pinned adaptations; independent knowledge-workspace/frontend/service/shared boundaries.`);
}
