import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function sourceDependencies(ast) {
  const result = [];
  function visit(node) {
    let literal, typeOnly = false, lazy = false;
    if (ts.isImportDeclaration(node)) {
      literal = node.moduleSpecifier;
      const clause = node.importClause;
      typeOnly = clause?.isTypeOnly || Boolean(clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length && clause.namedBindings.elements.every(element => element.isTypeOnly));
    }
    else if (ts.isExportDeclaration(node)) {
      literal = node.moduleSpecifier;
      typeOnly = node.isTypeOnly || Boolean(node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length && node.exportClause.elements.every(element => element.isTypeOnly));
    }
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) { literal = node.arguments[0]; lazy = true; }
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) { literal = node.argument.literal; typeOnly = true; }
    if (literal && ts.isStringLiteral(literal)) result.push({ specifier: literal.text, typeOnly, ...(lazy ? { lazy: true } : {}) });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

/** Static runtime cycles hide ownership and couple initialization; lazy/type edges are excluded. */
export function runtimeCycles(graph) {
  let index = 0;
  const stack = [], active = new Set(), indices = new Map(), low = new Map(), cycles = [];
  function visit(file) {
    indices.set(file, index); low.set(file, index++); stack.push(file); active.add(file);
    for (const target of graph.get(file) ?? []) {
      if (!indices.has(target)) { visit(target); low.set(file, Math.min(low.get(file), low.get(target))); }
      else if (active.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)));
    }
    if (low.get(file) === indices.get(file)) {
      const group = []; let target;
      do { target = stack.pop(); active.delete(target); group.push(target); } while (target !== file);
      if (group.length > 1 || graph.get(file)?.includes(file)) cycles.push(group.sort());
    }
  }
  for (const file of graph.keys()) if (!indices.has(file)) visit(file);
  return cycles;
}

/** Resolve source imports without loading the application or executing package code. */
export function resolveSource(root, importer, specifier) {
  const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(root, path.dirname(importer), specifier) : undefined;
  if (!base) return undefined;
  const file = [base, ...['.ts', '.tsx', '.mjs', '.js', '.json', '/index.ts', '/index.tsx'].map(suffix => base + suffix)]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return file && path.relative(root, file).replaceAll('\\', '/');
}

/** Cross-runtime and lower-layer boundaries apply equally to static and lazy imports. */
export function dependencyIssues({ file, specifier, target, typeOnly = false, sharedExports }) {
  const issues = [];
  if (target?.startsWith('../')) issues.push(`Source dependency leaves the repository: ${file} -> ${specifier}`);
  if (specifier === '@fob/shared' || specifier.startsWith('@fob/shared/')) {
    const subpath = specifier === '@fob/shared' ? '.' : './' + specifier.slice('@fob/shared/'.length);
    if (!Object.hasOwn(sharedExports, subpath)) issues.push(`Unpublished shared entry: ${file} -> ${specifier}`);
  }
  if (file.startsWith('shared/src/')) {
    if (target?.startsWith('src/') || target?.startsWith('backend/') || /^@fob\/server(?:\/|$)/.test(specifier))
      issues.push(`Shared domain imports a product implementation: ${file} -> ${specifier}`);
    if (/^(?:react(?:-dom)?(?:\/|$)|next(?:\/|$)|@tiptap\/react(?:\/|$)|node:|bun$)/.test(specifier))
      issues.push(`Shared domain imports a runtime-specific dependency: ${file} -> ${specifier}`);
  }
  if (file.startsWith('src/')) {
    if (specifier.startsWith('@fob/server/') && (specifier !== '@fob/server/knowledge-api' || !typeOnly))
      issues.push(`Frontend must use the type-only public knowledge API: ${file} -> ${specifier}`);
    if (target?.startsWith('backend/') || target?.startsWith('shared/'))
      issues.push(`Frontend bypasses a package boundary: ${file} -> ${specifier}`);
    if (/^src\/(?:components|lib)\//.test(file) && /^src\/(?:features|shell)\//.test(target ?? ''))
      issues.push(`Reusable UI/library imports a product feature: ${file} -> ${specifier}`);
  }
  if (file.startsWith('backend/') && target?.startsWith('src/'))
    issues.push(`Business service imports browser UI: ${file} -> ${specifier}`);
  return issues;
}

/** Retain the migration identity while allowing a reviewed, unique in-repository relocation. */
export function reviewedSourcePath(original, adaptation = {}) {
  const target = adaptation.relocatedTo ?? original;
  if (typeof target !== 'string' || !/^(?:src|shared|backend)\//.test(target)
    || target.includes('\\') || target.split('/').some(part => !part || part === '.' || part === '..')
    || (adaptation.relocatedTo !== undefined && target === original)) {
    throw new Error(`Invalid reviewed relocation: ${original}`);
  }
  return target;
}
