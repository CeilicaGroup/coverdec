// Lista las llamadas cuyo resultado es Promise<ActionResult<…>> y se descarta
// (sentencia suelta, `void x()`, cuerpo de arrow que nadie usa…).
// Va en `npm run typecheck`: un ActionResult ignorado es un error que el usuario no ve.
const path = require("path");
const repo = path.resolve(__dirname, "..");
const ts = require(path.join(repo, "node_modules/typescript"));
const configPath = path.join(repo, "tsconfig.json");
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, repo);
const program = ts.createProgram(cfg.fileNames, cfg.options);
const checker = program.getTypeChecker();

function isActionResultPromise(type) {
  const s = checker.typeToString(type);
  return /^Promise<ActionResult</.test(s) || /^Promise<\{ ok: true; data:/.test(s);
}

const hits = [];
for (const sf of program.getSourceFiles()) {
  const f = sf.fileName.replace(/\\/g, "/");
  if (!f.includes("/src/") || f.includes("/generated/") || /\.test\.tsx?$/.test(f) || f.includes("__tests__")) continue;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const type = checker.getTypeAtLocation(node);
      if (isActionResultPromise(type)) {
        let p = node.parent;
        while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
        // () => action() pasado a un handler que ignora lo devuelto (onClick, startTransition…)
        const arrowIgnored =
          ts.isArrowFunction(p) &&
          (ts.isJsxExpression(p.parent) ||
            (ts.isCallExpression(p.parent) && /startTransition$/.test(p.parent.expression.getText())));
        const discarded = ts.isExpressionStatement(p) || ts.isVoidExpression(p) || arrowIgnored;
        if (discarded) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          hits.push(`${path.relative(repo, f)}:${line + 1}  ${node.getText().split("\n")[0].slice(0, 90)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
if (hits.length) {
  console.error(hits.join("\n"));
  console.error(`\n${hits.length} llamadas ignoran el ActionResult: comprueba result.ok y muestra result.error.`);
  process.exit(1);
}
