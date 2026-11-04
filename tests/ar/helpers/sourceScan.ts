// Static scan of the camera AR sources for the architecture tests (docs/test_plan_camera_ar.md §4.10,
// OQ-03): the import edges of a module, as parsed by the TypeScript compiler so that comments and
// strings cannot fool it, and its references to browser globals used as values.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The repository's src directory, found relative to this file. */
export const SRC_DIR = fileURLToPath(new URL("../../../src/", import.meta.url));

export interface ImportEdge {
  readonly specifier: string;
  /** Erased at runtime: `import type`, `export type … from`, every named binding marked `type`, or a type-level `import("…")`. */
  readonly typeOnly: boolean;
  readonly line: number;
  /** The target inside src without extension, such as "ar/board", or null for a package. */
  readonly target: string | null;
}

export interface GlobalUse {
  readonly name: string;
  readonly line: number;
  /** The top-level function or variable declaration the use sits in, or null at the top level itself. */
  readonly scope: string | null;
}

export interface ModuleScan {
  /** The file name without extension, such as "pipeline" or "tracker.worker". */
  readonly name: string;
  readonly path: string;
  readonly imports: readonly ImportEdge[];
  readonly globals: readonly GlobalUse[];
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function targetOf(specifier: string, fromFile: string): string | null {
  let path: string;
  if (specifier.startsWith("@/")) path = join(SRC_DIR, specifier.slice(2));
  else if (specifier.startsWith(".")) path = resolve(dirname(fromFile), specifier);
  else return null; // a package
  const rel = relative(SRC_DIR, path).split("\\").join("/");
  const ext = extname(rel);
  return EXTENSIONS.includes(ext) ? rel.slice(0, -ext.length) : rel;
}

function isInTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current) || ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) return true;
    if (ts.isExpressionStatement(current) || ts.isBlock(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

/** Whether an identifier is a value reference rather than a property name, a declaration or a type. */
function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isFunctionDeclaration(parent)) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  return !isInTypePosition(node);
}

/** Parses one module and lists its imports and its value references to the given global names. */
export function scanModule(path: string, globalNames: readonly string[]): ModuleScan {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: ImportEdge[] = [];
  const globals: GlobalUse[] = [];
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const add = (specifier: string, typeOnly: boolean, node: ts.Node): void => {
    imports.push({ specifier, typeOnly, line: lineOf(node), target: targetOf(specifier, path) });
  };
  // The top-level declaration a node sits in, for GlobalUse.scope
  const scopeOf = (statement: ts.Node): string | null => {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) return statement.name.text;
    if (ts.isVariableStatement(statement)) {
      const first = statement.declarationList.declarations[0];
      return first && ts.isIdentifier(first.name) ? first.name.text : null;
    }
    return null;
  };
  const visit = (node: ts.Node, scope: string | null): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings : undefined;
      const allNamedTypes = !!named && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && allNamedTypes));
      add(node.moduleSpecifier.text, typeOnly, node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause : undefined;
      const allNamedTypes = !!named && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
      add(node.moduleSpecifier.text, node.isTypeOnly || allNamedTypes, node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node.moduleReference.expression.text, node.isTypeOnly, node);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) add(node.arguments[0].text, false, node);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node.argument.literal.text, true, node);
    } else if (ts.isIdentifier(node) && globalNames.includes(node.text) && isValueReference(node)) {
      globals.push({ name: node.text, line: lineOf(node), scope });
    }
    ts.forEachChild(node, (child) => visit(child, node === source ? scopeOf(child) : scope));
  };
  visit(source, null);
  const base = path.split(/[\\/]/).pop() as string;
  return { name: base.slice(0, -extname(base).length), path, imports, globals };
}

/** Scans every source module in a directory and its subdirectories (tests and declarations excluded). */
export function scanDirectory(dir: string, globalNames: readonly string[]): ModuleScan[] {
  if (!existsSync(dir)) return [];
  const out: ModuleScan[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scanDirectory(path, globalNames));
    else if (/\.(m?ts|tsx)$/.test(entry.name) && !/\.d\.ts$|\.test\.tsx?$/.test(entry.name)) out.push(scanModule(path, globalNames));
  }
  return out;
}
