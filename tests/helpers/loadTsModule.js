const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const cache = new Map();

const runCompiled = (code, filename, dirname, requireFn, moduleObj) => {
  const wrapper = `(function (exports, require, module, __filename, __dirname) {${code}\n})`;
  const script = new vm.Script(wrapper, { filename });
  const compiled = script.runInThisContext();
  compiled(moduleObj.exports, requireFn, moduleObj, filename, dirname);
};

const resolveCandidates = (resolvedPath) => {
  const candidates = [];
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    candidates.push(resolvedPath);
    return candidates;
  }
  const ext = path.extname(resolvedPath);
  if (ext) {
    candidates.push(resolvedPath);
    return candidates;
  }
  candidates.push(`${resolvedPath}.ts`);
  candidates.push(`${resolvedPath}.tsx`);
  candidates.push(`${resolvedPath}.js`);
  candidates.push(`${resolvedPath}.mjs`);
  candidates.push(`${resolvedPath}.cjs`);
  candidates.push(`${resolvedPath}.json`);
  candidates.push(path.join(resolvedPath, 'index.ts'));
  candidates.push(path.join(resolvedPath, 'index.tsx'));
  candidates.push(path.join(resolvedPath, 'index.js'));
  candidates.push(path.join(resolvedPath, 'index.mjs'));
  candidates.push(path.join(resolvedPath, 'index.cjs'));
  candidates.push(path.join(resolvedPath, 'index.json'));
  return candidates;
};

const loadResolved = (inputPath) => {
  const normalized = path.normalize(inputPath);
  const fullPath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
  if (cache.has(fullPath)) {
    return cache.get(fullPath).exports;
  }
  for (const candidate of resolveCandidates(fullPath)) {
    if (!fs.existsSync(candidate)) continue;
    if (cache.has(candidate)) return cache.get(candidate).exports;
    if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
      return loadTsModule(candidate);
    }
    return require(candidate);
  }
  throw new Error(`Unable to resolve module at ${inputPath}`);
};

function loadTsModule(filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  if (cache.has(absolutePath)) {
    return cache.get(absolutePath).exports;
  }
  const source = fs.readFileSync(absolutePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
      isolatedModules: false,
    },
    fileName: absolutePath,
  });
  const moduleObj = { exports: {} };
  cache.set(absolutePath, moduleObj);
  const dirname = path.dirname(absolutePath);
  const requireFn = (specifier) => {
    if (specifier.startsWith('@/')) {
      return loadResolved(path.join(process.cwd(), specifier.slice(2)));
    }
    if (specifier.startsWith('.') || specifier.startsWith('..')) {
      return loadResolved(path.resolve(dirname, specifier));
    }
    return require(specifier);
  };
  runCompiled(transpiled.outputText, absolutePath, dirname, requireFn, moduleObj);
  return moduleObj.exports;
}

module.exports = { loadTsModule };
