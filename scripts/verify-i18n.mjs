import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}
function placeholders(text) {
  return [
    ...new Set(
      [...text.matchAll(/\{\{|\}\}|\{(\w+)\}/g)].flatMap((match) => (match[1] ? [match[1]] : [])),
    ),
  ]
    .sort()
    .join(',');
}

const issues = [];
const units = new Map();
let catalogs = 0,
  entries = 0;
for (const file of files(path.join(root, 'src')).filter(
  (file) => /\.tsx?$/.test(file) && !/\.test\./.test(file),
)) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const unit = { ast, catalogs: new Map() };
  units.set(file, unit);
  const relative = path.relative(root, file).replaceAll('\\', '/');
  function issue(node, message) {
    issues.push(
      `${relative}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} ${message}`,
    );
  }
  const clientDirective = ast.statements.findIndex(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === 'use client',
  );
  if (clientDirective > 0)
    issue(
      ast.statements[clientDirective],
      'The use client directive must precede imports and expressions',
    );
  function visit(node) {
    let object;
    let name;
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'defineMessages') {
      object = node.arguments[0];
      name = ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(ast) : undefined;
    } else if (ts.isVariableDeclaration(node) && node.name.getText(ast).endsWith('Messages')) {
      let initializer = node.initializer;
      while (
        initializer &&
        (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))
      )
        initializer = initializer.expression;
      if (
        initializer &&
        ts.isObjectLiteralExpression(initializer) &&
        initializer.properties.length &&
        initializer.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) && ts.isArrayLiteralExpression(property.initializer),
        )
      ) {
        object = initializer;
        name = node.name.getText(ast);
      }
    }
    if (object) {
      catalogs++;
      if (!object || !ts.isObjectLiteralExpression(object)) {
        issue(node, 'Catalog must contain explicit bilingual entries');
        return;
      }
      const catalog = new Map();
      if (name) unit.catalogs.set(name, catalog);
      const keys = new Set();
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) {
          issue(property, 'Catalog entries must be explicit');
          continue;
        }
        const key = ts.isStringLiteral(property.name)
          ? property.name.text
          : property.name.getText(ast);
        if (keys.has(key)) issue(property, 'Duplicate message key');
        keys.add(key);
        const pair = property.initializer;
        if (
          !ts.isArrayLiteralExpression(pair) ||
          pair.elements.length !== 2 ||
          !pair.elements.every(
            (element) => ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element),
          )
        ) {
          issue(property, 'Each message needs Chinese and English strings');
          continue;
        }
        const [chinese, english] = pair.elements.map((element) => element.text);
        catalog.set(key, placeholders(chinese).split(',').filter(Boolean));
        entries++;
        if (!chinese.trim() || !english.trim()) issue(property, 'A translation is empty');
        if (placeholders(chinese) !== placeholders(english))
          issue(property, 'Interpolation parameters differ between languages');
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function resolveImport(file, specifier) {
  const target = specifier.startsWith('@/')
    ? path.join(root, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(file), specifier)
      : undefined;
  return (
    target &&
    [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')].find((candidate) =>
      units.has(candidate),
    )
  );
}
function scope(node) {
  while (node && !ts.isBlock(node) && !ts.isSourceFile(node)) node = node.parent;
  return node;
}
function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}
for (const [file, unit] of units) {
  const { ast } = unit;
  const available = new Map(unit.catalogs);
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    )
      continue;
    const importedFile = resolveImport(file, statement.moduleSpecifier.text);
    for (const entry of statement.importClause.namedBindings.elements) {
      const catalog =
        importedFile &&
        units.get(importedFile).catalogs.get((entry.propertyName ?? entry.name).text);
      if (catalog) available.set(entry.name.text, catalog);
    }
  }
  const translators = new WeakMap();
  function bindings(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const expression =
        ts.isPropertyAccessExpression(node.initializer) && node.initializer.name.text === 't'
          ? node.initializer.expression
          : node.initializer;
      if (
        ts.isCallExpression(expression) &&
        ['useTranslation', 'createTranslator', 'createUiMessages'].includes(
          expression.expression.getText(ast),
        )
      ) {
        const catalog = available.get(expression.arguments[0]?.getText(ast));
        if (catalog) {
          const owner = scope(node);
          const names = translators.get(owner) ?? new Map();
          translators.set(owner, names);
          if (ts.isIdentifier(node.name)) names.set(node.name.text, catalog);
          else if (ts.isObjectBindingPattern(node.name))
            for (const element of node.name.elements) {
              if (
                (expression.expression.getText(ast) === 'createUiMessages'
                  ? ['message', 'error']
                  : ['t']
                ).includes((element.propertyName ?? element.name).getText(ast))
              )
                names.set(element.name.getText(ast), catalog);
            }
        }
      }
    }
    ts.forEachChild(node, bindings);
  }
  bindings(ast);
  function issue(node, message) {
    issues.push(
      `${path.relative(root, file).replaceAll('\\', '/')}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} ${message}`,
    );
  }
  function audit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      let catalog;
      let keyIndex = 0;
      if (node.expression.text === 'translate') {
        catalog = available.get(node.arguments[0]?.getText(ast));
        keyIndex = 1;
      } else
        for (let owner = scope(node); owner && !catalog; owner = scope(owner.parent))
          catalog = translators.get(owner)?.get(node.expression.text);
      const key = literal(node.arguments[keyIndex]);
      if (catalog && key !== undefined) {
        const parameters = catalog.get(key);
        if (!parameters) issue(node, `Unknown message: ${key}`);
        else {
          const values = node.arguments[keyIndex + 1];
          if (parameters.length && (!values || values.getText(ast) === 'undefined'))
            issue(node, `Missing interpolation values: ${key}`);
          else if (
            values &&
            ts.isObjectLiteralExpression(values) &&
            !values.properties.some(ts.isSpreadAssignment)
          ) {
            const keys = values.properties.map(
              (property) => literal(property.name) ?? property.name?.getText(ast),
            );
            const missing = parameters.filter((parameter) => !keys.includes(parameter));
            const extra = keys.filter((parameter) => !parameters.includes(parameter));
            if (missing.length)
              issue(node, `Missing interpolation parameters: ${key} (${missing.join(', ')})`);
            if (extra.length)
              issue(node, `Unused interpolation parameters: ${key} (${extra.join(', ')})`);
          }
        }
      }
    }
    ts.forEachChild(node, audit);
  }
  audit(ast);
}
if (catalogs === 0) issues.push('No bilingual catalogs found');
if (issues.length) {
  process.stderr.write(issues.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Internationalization verified: ${catalogs} catalogs, ${entries} bilingual messages and static interpolation calls.\n`,
  );
}
