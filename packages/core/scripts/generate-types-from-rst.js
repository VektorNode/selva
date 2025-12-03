const fs = require('fs');
const path = require('path');

/**
 * Generate TypeScript declarations from .rst docs of compute-rhino3d
 * Just a best-effort approach, may need manual cleanup
 */

const INPUT_DIR =
  process.argv[2] || path.join(__dirname, '..', 'node_modules', 'compute-rhino3d', 'docs');
const OUT_FILE = process.argv[3] || path.join(__dirname, '..', 'types', 'compute-rhino3d.d.ts');

function walk(dir) {
  const files = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else if (full.endsWith('.rst')) files.push(full);
  }
  return files;
}

function mapType(t) {
  if (!t) return 'any';
  t = t.trim();
  if (t === 'bool' || /^bool/i.test(t)) return 'boolean';
  if (t === 'int' || t === 'integer' || t === 'float' || t === 'double' || t === 'number')
    return 'number';
  const listMatch = t.match(/^list\[(.+)\]$/i) || t.match(/^\[(.+)\]$/);
  if (listMatch) return mapType(listMatch[1]) + '[]';
  // keep rhino3dm types as-is, map simple names to any
  if (/^rhino3dm\./.test(t)) return t;
  if (/^[A-Za-z0-9_]+$/.test(t)) return t; // assume defined elsewhere (e.g. VolumeMassProperties)
  return 'any';
}

function parseFile(content) {
  // find all js:function directives
  const results = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const funcMatch = line.match(/^\.\. js:function::\s*(.+)$/);
    if (!funcMatch) continue;
    const signature = funcMatch[1].trim(); // e.g. RhinoCompute.VolumeMassProperties.compute(mesh, multiple=false)
    const parts = signature.split('.');
    // expect at least RhinoCompute.ClassName.funcName(...)
    if (parts.length < 3) continue;
    const namespace = parts[0]; // RhinoCompute
    const className = parts[1];
    // extract func name and params from last part
    const last = parts.slice(2).join('.');
    const sigMatch = last.match(/^([^(]+)\((.*)\)$/);
    const funcName = sigMatch ? sigMatch[1].trim() : last;
    const sigParams = sigMatch ? sigMatch[2].trim() : '';
    // collect subsequent :param and :rtype: lines
    const params = [];
    let returnType = null;
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j].trim();
      if (l.startsWith('.. js:') || l.startsWith('.. _') || l.startsWith('.. ')) break;
      const pMatch = l.match(/^:param\s+([^\s:]+)\s+([^\s:]+)\s*:/);
      if (pMatch) {
        params.push({ type: pMatch[1], name: pMatch[2] });
      }
      const rMatch = l.match(/^:rtype:\s*(.+)$/);
      if (rMatch) {
        returnType = rMatch[1].trim();
      }
      j++;
    }
    results.push({ namespace, className, funcName, sigParams, params, returnType });
  }
  return results;
}

function buildDeclarations(entries) {
  const byClass = {};
  entries.forEach((e) => {
    const key = e.className;
    byClass[key] = byClass[key] || { namespace: e.namespace, funcs: [] };
    byClass[key].funcs.push(e);
  });

  const lines = [];
  lines.push('// Auto-generated from .rst docs');
  lines.push('declare namespace RhinoCompute {');
  Object.keys(byClass).forEach((cls) => {
    lines.push(`  namespace ${cls} {`);
    byClass[cls].funcs.forEach((f) => {
      // use documented params if available, fallback to signature parsing
      let paramList = [];
      if (f.params && f.params.length) {
        paramList = f.params.map((p) => {
          // detect optional from signature default pattern
          const sigOptMatch = new RegExp('\\b' + p.name + '\\s*=\\s*').test(f.sigParams);
          const optionalFlag = sigOptMatch ? '?' : '';
          return `${p.name}${optionalFlag}: ${mapType(p.type)}`;
        });
      } else if (f.sigParams) {
        // parse params names and defaults from signature
        const raw = f.sigParams.trim();
        if (raw.length) {
          paramList = raw.split(',').map((p) => {
            p = p.trim();
            const [left] = p.split('=');
            const name = left.trim().split(/\s+/).pop();
            const optional = /=/.test(p) ? '?' : '';
            return `${name}${optional}: any`;
          });
        }
      }
      const ret = mapType(f.returnType || 'any');
      lines.push(`    function ${f.funcName}(${paramList.join(', ')}): ${ret} | null;`);
    });
    lines.push('  }');
  });
  lines.push('  // add interfaces for return types if needed');
  lines.push('}');
  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error('Input dir not found:', INPUT_DIR);
    process.exit(1);
  }
  const files = walk(INPUT_DIR);
  const all = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    all.push(...parseFile(content));
  }
  const out = buildDeclarations(all);
  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_FILE, out, 'utf8');
  console.log('Wrote', OUT_FILE);
}
main();
