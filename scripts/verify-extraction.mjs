import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { dependencyIssues, resolveSource, reviewedSourcePath, sourceDependencies, runtimeCycles } from './architecture-boundaries.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root, '.spec/source-baseline.json'), 'utf8'));
const adaptationsPath = path.join(root, '.spec/source-adaptations.json');
const adaptations = fs.existsSync(adaptationsPath) ? JSON.parse(fs.readFileSync(adaptationsPath, 'utf8')) : {};
const issues = [];
const sharedExports = JSON.parse(fs.readFileSync(path.join(root, 'shared/package.json'), 'utf8')).exports;
const reviewedTargets = new Set();
const runtimeGraph = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = (value, kind) => kind === 'binary' ? value : value.toString('utf8').replace(/\r\n?/g, '\n');
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? files(target) : [target];
});

for (const entry of baseline.files) {
  const adaptation = adaptations[entry.path];
  let target;
  try { target = reviewedSourcePath(entry.path, adaptation); }
  catch (error) { issues.push(error.message); continue; }
  const file = path.join(root, target);
  if (reviewedTargets.has(target)) issues.push(`Duplicate reviewed destination: ${target}`);
  reviewedTargets.add(target);
  if (adaptation?.deleted === true) {
    if (!adaptation.reason || adaptation.sha256) issues.push(`Invalid reviewed deletion: ${entry.path}`);
    if (fs.existsSync(file)) issues.push(`Deleted capability has been reintroduced: ${entry.path}`);
    continue;
  }
  if (adaptation?.relocatedTo && fs.existsSync(path.join(root, entry.path))) issues.push(`Relocated source still has a legacy copy: ${entry.path}`);
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
    const runtimeTargets = [];
    for (const { specifier, typeOnly, lazy } of sourceDependencies(ast)) {
        if (specifier.startsWith('@tauri-apps/') || specifier.includes('backend/device')) issues.push(`Desktop dependency: ${relative} -> ${specifier}`);
        if (/features\/project(?:\/|$)|@fob\/shared\/projects|modules\/projects(?:\/|$)/.test(specifier)) issues.push(`Separate project layer in knowledge product: ${relative} -> ${specifier}`);
        const publicShared = specifier.startsWith('@fob/shared/') && sharedExports['./' + specifier.slice('@fob/shared/'.length)];
        const target = resolveSource(root, relative, specifier);
        if (!typeOnly && !lazy) {
          const runtimeTarget = target ?? (publicShared && `shared/${publicShared.replace(/^\.\//, '')}`);
          if (runtimeTarget) runtimeTargets.push(runtimeTarget);
        }
        issues.push(...dependencyIssues({ file: relative, specifier, target, typeOnly, sharedExports }));
        if ((specifier.startsWith('.') || specifier.startsWith('@/')) && !target) issues.push(`Unresolved source dependency: ${relative} -> ${specifier}`);
    }
    runtimeGraph.set(relative, runtimeTargets);
  }
}
for (const cycle of runtimeCycles(runtimeGraph)) issues.push(`Static runtime dependency cycle: ${cycle.join(' -> ')}`);

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
  const relocated = Object.values(adaptations).filter(value => value.relocatedTo).length;
  console.log(`Fob extraction verified: ${baseline.files.length} source entries, ${baseline.files.length - removed} retained files, ${removed} reviewed obsolete deletions, ${relocated} reviewed relocations, ${Object.keys(adaptations).length - removed} pinned adaptations; ${runtimeGraph.size} runtime modules, no static runtime cycles; public package boundaries verified.`);
}
