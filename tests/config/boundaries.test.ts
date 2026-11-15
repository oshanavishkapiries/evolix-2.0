import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = resolve(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|mjs)$/.test(p) ? [p] : [];
  });
}
const paths = [...sources(resolve(root, "app")), ...sources(resolve(root, "lib")), resolve(root, "proxy.ts")];
const helpers = new Set(["engines", "defaultEngine", "engineById", "viewerStreamUrl", "isAdminEmail", "isEngineCall", "tokenKey", "getTransporter", "setAuthCookies", "adminEngine"]);
function ast(path: string) { return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true); }
function resolveImport(from: string, spec: string) {
  const base = spec.startsWith("@/") ? resolve(root, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : undefined;
  return base && [base + ".ts", base + ".tsx", resolve(base, "index.ts"), resolve(base, "index.tsx")].find(existsSync);
}
describe("config boundaries", () => {
  it("awaits every imported migrated helper at its call sites", () => {
    const failures: string[] = [];
    for (const path of paths) {
      const file = ast(path); const names = new Set<string>();
      for (const stmt of file.statements) {
        if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        const bindings = stmt.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          if (helpers.has(binding.propertyName?.text ?? binding.name.text)) names.add(binding.name.text);
        }
      }
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) {
          let parent = node.parent;
          while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
          if (!ts.isAwaitExpression(parent)) failures.push(`${path.slice(root.length + 1)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
    }
    expect(failures).toEqual([]);
  });
  it("keeps the DB config loader outside browser and edge import graphs", () => {
    const failures: string[] = [];
    function walk(path: string, origin: string, seen = new Set<string>()) {
      if (seen.has(path)) return; seen.add(path);
      if (path === resolve(root, "lib/config/index.ts") || path === resolve(root, "lib/config/store.ts")) { failures.push(origin); return; }
      const text = readFileSync(path, "utf8");
      if (/^["']use server["'];/.test(text)) return; // Server actions are an explicit server boundary.
      const file = ast(path);
      for (const stmt of file.statements) {
        if (!(ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        if (ts.isImportDeclaration(stmt) && stmt.importClause?.isTypeOnly) continue;
        if (ts.isExportDeclaration(stmt) && stmt.isTypeOnly) continue;
        if (stmt.moduleSpecifier.text === "zod") failures.push(`${origin} imports browser Zod through ${path.slice(root.length + 1)}`);
        const target = resolveImport(path, stmt.moduleSpecifier.text);
        if (target) walk(target, origin, seen);
      }
    }
    for (const path of paths) {
      const text = readFileSync(path, "utf8");
      if (/^["']use client["'];/.test(text) || /export const runtime\s*=\s*["']edge["']/.test(text)) walk(path, path.slice(root.length + 1));
    }
    expect(failures).toEqual([]);
  });
});
