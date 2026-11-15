// De-bundler: cuts chosen modules out of the minified esbuild bundle in index.html and writes them as ES modules.
// usage: node lift.cjs <index.html> <acorn dir> <prettier dir> <config.json> <outdir>
const fs = require('fs'), path = require('path');
const [, , HTML, ACORN, PRETTIER, CONFIG, OUT] = process.argv;
const acorn = require(ACORN);
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const html = fs.readFileSync(HTML, 'utf8');
let src = ''; { const re = /<script>([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(html))) if (m[1].length > src.length) src = m[1]; }
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
const top = ast.body[0].expression.callee.body.body;

// ---- top-level bindings -------------------------------------------------------------------------------------------
const patNames = (p, out) => {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => patNames(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((q) => patNames(q, out));
  else if (p.type === 'AssignmentPattern') patNames(p.left, out);
  else if (p.type === 'RestElement') patNames(p.argument, out);
  return out;
};
const declOf = new Map(); // name -> statement index
const stmtDecls = top.map((s, i) => {
  const n = [];
  if (s.type === 'VariableDeclaration') s.declarations.forEach((d) => patNames(d.id, n));
  else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') n.push(s.id.name);
  n.forEach((x) => declOf.set(x, i));
  return n;
});

// three's namespace: statement `br(lt, { Name: () => min, ... })`
const three = new Map(); // min -> Name
let nsName = null;
for (const s of top) {
  if (s.type === 'ExpressionStatement' && s.expression.type === 'CallExpression' && s.expression.arguments.length === 2 && s.expression.arguments[1].type === 'ObjectExpression') {
    const props = s.expression.arguments[1].properties;
    if (props.some((p) => p.key.name === 'REVISION')) {
      nsName = s.expression.arguments[0].name;
      for (const p of props) three.set(p.value.body.name, p.key.name);
    }
  }
}
const threeEnd = Math.max(...[...three.keys()].map((m) => declOf.get(m) ?? 0));

// ---- scope-aware reference scan ----------------------------------------------------------------------------------
function varNames(node, out) { // `var` declarations and (for the function body) nothing nested in other functions
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') node.declarations.forEach((d) => patNames(d.id, out));
  for (const k in node) { const v = node[k]; if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && varNames(c, out)); else if (v && typeof v.type === 'string') varNames(v, out); }
}
function blockNames(list, out) {
  for (const s of list) {
    if (!s) continue;
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach((d) => patNames(d.id, out));
    else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') out.push(s.id.name);
  }
}
function scan(stmt) { // -> [{ start, end, name, shorthand, write }]
  const refs = [], scopes = [];
  const resolvesTop = (n) => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return false; return declOf.has(n); };
  const ref = (id, extra) => { if (resolvesTop(id.name)) refs.push({ start: id.start, end: id.end, name: id.name, ...extra }); };
  function fn(node) {
    const names = []; node.params.forEach((p) => patNames(p, names));
    if (node.body.type === 'BlockStatement') { node.body.body.forEach((s) => varNames(s, names)); blockNames(node.body.body, names); }
    if (node.type === 'FunctionExpression' && node.id) names.push(node.id.name);
    scopes.push(new Set(names));
    node.params.forEach((p) => walk(p));
    if (node.body.type === 'BlockStatement') node.body.body.forEach((s) => walk(s)); else walk(node.body);
    scopes.pop();
  }
  function walk(node, parent) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'Identifier': ref(node); return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if (node.type === 'FunctionDeclaration' && node.id) ref(node.id);
        fn(node); return;
      case 'ClassDeclaration': case 'ClassExpression': {
        if (node.type === 'ClassDeclaration') ref(node.id);
        scopes.push(new Set(node.id ? (node.type === 'ClassExpression' ? [node.id.name] : []) : []));
        walk(node.superClass); node.body.body.forEach((m) => walk(m)); scopes.pop(); return;
      }
      case 'MethodDefinition': case 'PropertyDefinition':
        if (node.computed) walk(node.key); walk(node.value); return;
      case 'Property':
        if (node.computed) walk(node.key);
        if (node.shorthand) {
          const id = node.value.type === 'AssignmentPattern' ? node.value.left : node.value;
          if (id.type === 'Identifier') ref(id, { shorthand: true });
          if (node.value.type === 'AssignmentPattern') walk(node.value.right);
        } else walk(node.value);
        return;
      case 'MemberExpression': walk(node.object); if (node.computed) walk(node.property); return;
      case 'LabeledStatement': walk(node.body); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'BlockStatement': case 'StaticBlock': { const n = []; blockNames(node.body, n); scopes.push(new Set(n)); node.body.forEach((s) => walk(s)); scopes.pop(); return; }
      case 'SwitchStatement': { walk(node.discriminant); const n = []; node.cases.forEach((c) => blockNames(c.consequent, n)); scopes.push(new Set(n)); node.cases.forEach((c) => { walk(c.test); c.consequent.forEach((s) => walk(s)); }); scopes.pop(); return; }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const n = []; const init = node.init || node.left; if (init && init.type === 'VariableDeclaration' && init.kind !== 'var') init.declarations.forEach((d) => patNames(d.id, n));
        scopes.push(new Set(n)); for (const k of ['init', 'left', 'right', 'test', 'update', 'body']) walk(node[k]); scopes.pop(); return;
      }
      case 'CatchClause': { const n = []; patNames(node.param, n); scopes.push(new Set(n)); walk(node.param); walk(node.body); scopes.pop(); return; }
      case 'AssignmentExpression': markWrite(node.left); walk(node.left); walk(node.right); return;
      case 'UpdateExpression': markWrite(node.argument); walk(node.argument); return;
      default:
        for (const k in node) { if (k === 'type' || k === 'start' || k === 'end') continue; const v = node[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, node)); else if (v && typeof v.type === 'string') walk(v, node); }
    }
  }
  const writes = new Set();
  function markWrite(t) { const n = []; if (t.type === 'Identifier') n.push(t.name); else patNames(t, n); n.forEach((x) => { if (resolvesTop(x)) writes.add(x); }); }
  walk(stmt);
  return { refs, writes };
}

// ---- closure from the roots -------------------------------------------------------------------------------------
const scans = new Map();
const scanOf = (i) => { if (!scans.has(i)) scans.set(i, scan(top[i])); return scans.get(i); };
const stop = new Set(cfg.stub || []); // names never followed (the caller supplies a stub or removes the use)
const inc = new Set();
const queue = cfg.roots.map((n) => { if (!declOf.has(n)) throw new Error('no root ' + n); return declOf.get(n); });
while (queue.length) {
  const i = queue.pop(); if (inc.has(i)) continue; inc.add(i);
  for (const r of scanOf(i).refs) {
    if (three.has(r.name) || r.name === nsName || stop.has(r.name)) continue;
    const d = declOf.get(r.name);
    if (d <= threeEnd && !cfg.allowThreeInternals) { console.error(`! ${stmtDecls[i].join(',')} uses three internal ${r.name}`); }
    queue.push(d);
  }
}
// top-level side-effect statements inside chosen ranges whose references are all included (e.g. shader chunk registration)
for (const m of cfg.modules) for (let i = m.from; i <= m.to; i++) {
  if (inc.has(i) || top[i].type !== 'ExpressionStatement') continue;
  const e = top[i].expression;
  if (e.type === 'CallExpression' && e.callee.type === 'Identifier' && e.callee.name === 'br') continue; // namespace objects
  const refs = scanOf(i).refs.filter((r) => !three.has(r.name) && r.name !== nsName);
  if (refs.length && refs.every((r) => inc.has(declOf.get(r.name)))) inc.add(i);
}

const moduleOf = (i) => { for (const m of cfg.modules) if (i >= m.from && i <= m.to) return m.file; return cfg.shared; };
const rename = new Map(Object.entries(cfg.rename || {}));
const newName = (n) => (three.has(n) ? three.get(n) : n === nsName ? 'THREE' : rename.get(n) || n);

const files = new Map();
for (const i of [...inc].sort((a, b) => a - b)) { const f = moduleOf(i); if (!files.has(f)) files.set(f, []); files.get(f).push(i); }

const report = [];
for (const [file, idx] of files) {
  const imports = new Map(), threeNames = new Set(); let useNs = false, body = '';
  for (const i of idx) {
    const s = top[i], { refs, writes } = scanOf(i);
    for (const w of writes) if (moduleOf(declOf.get(w)) !== file) report.push(`! ${file}: writes ${w} declared in ${moduleOf(declOf.get(w))}`);
    let text = '', at = s.start;
    for (const r of refs.sort((a, b) => a.start - b.start)) {
      const nn = newName(r.name);
      if (three.has(r.name)) threeNames.add(nn); else if (r.name === nsName) useNs = true;
      else if (stop.has(r.name)) { if (!imports.has('__stub')) imports.set('__stub', new Set()); imports.get('__stub').add(nn); }
      else { const f = moduleOf(declOf.get(r.name)); if (f !== file) { if (!imports.has(f)) imports.set(f, new Set()); imports.get(f).add(nn); } }
      if (nn === r.name) continue;
      text += src.slice(at, r.start) + (r.shorthand ? `${r.name}: ${nn}` : nn); at = r.end;
    }
    text += src.slice(at, s.end);
    const exportable = s.type === 'VariableDeclaration' || s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration';
    body += (exportable ? 'export ' : '') + text + '\n';
  }
  const rel = (f) => { let r = path.posix.relative(path.posix.dirname(file), f); return r.startsWith('.') ? r : './' + r; };
  let head = '';
  if (threeNames.size || useNs) head += `import ${useNs ? '* as THREE' : ''}${useNs && threeNames.size ? ', ' : ''}${threeNames.size ? `{ ${[...threeNames].sort().join(', ')} }` : ''} from '${rel(cfg.three)}';\n`;
  // `import * as X, {a}` is not valid: split
  if (useNs && threeNames.size) head = `import * as THREE from '${rel(cfg.three)}';\nimport { ${[...threeNames].sort().join(', ')} } from '${rel(cfg.three)}';\n`;
  for (const [f, names] of imports) head += f === '__stub' ? `// STUB NEEDED: ${[...names].join(', ')}\n` : `import { ${[...names].sort().join(', ')} } from '${rel(f)}';\n`;
  files.set(file, { idx, code: head + '\n' + body });
  report.push(`${file}: ${idx.length} statements, ${body.length} chars; imports from ${[...imports.keys()].join(', ')}`);
  if (file === cfg.shared) report.push('  shared: ' + idx.map((i) => `${i}:${stmtDecls[i].join(',').slice(0, 24)}(${top[i].end - top[i].start})`).join(' '));
}
(async () => {
  const prettier = require(PRETTIER);
  for (const [file, { code }] of files) {
    const p = path.join(OUT, file); fs.mkdirSync(path.dirname(p), { recursive: true });
    let outp = code;
    try { outp = await prettier.format(code, { parser: 'babel', printWidth: 120, singleQuote: true }); } catch (e) { report.push(`! prettier ${file}: ${String(e.message).slice(0, 300)}`); }
    fs.writeFileSync(p, outp);
  }
  console.log(report.join('\n'));
})();
