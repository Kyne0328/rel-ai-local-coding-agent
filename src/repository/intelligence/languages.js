import path from 'node:path';

const PARSER_VERSION = 1;
const MAX_SEARCH_TERMS = 768;

const EXTENSION_LANGUAGE = new Map([
  ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.ts', 'typescript'], ['.tsx', 'tsx'], ['.py', 'python'], ['.go', 'go'], ['.rs', 'rust'],
  ['.dart', 'dart'], ['.java', 'java'], ['.kt', 'kotlin'], ['.kts', 'kotlin'], ['.swift', 'swift'],
  ['.cs', 'csharp'], ['.c', 'c'], ['.h', 'c'], ['.cpp', 'cpp'], ['.cc', 'cpp'], ['.cxx', 'cpp'],
  ['.hpp', 'cpp'], ['.hh', 'cpp'], ['.hxx', 'cpp'], ['.rb', 'ruby'], ['.php', 'php'],
  ['.vue', 'vue'], ['.json', 'json'], ['.css', 'css'], ['.html', 'html'], ['.htm', 'html'],
  ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.toml', 'toml'], ['.sh', 'bash'], ['.bash', 'bash']
]);

const WASM_BY_LANGUAGE = Object.freeze({
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  dart: 'tree-sitter-dart.wasm',
  java: 'tree-sitter-java.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  swift: 'tree-sitter-swift.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  php: 'tree-sitter-php.wasm',
  vue: 'tree-sitter-vue.wasm',
  json: 'tree-sitter-json.wasm',
  css: 'tree-sitter-css.wasm',
  html: 'tree-sitter-html.wasm',
  yaml: 'tree-sitter-yaml.wasm',
  toml: 'tree-sitter-toml.wasm',
  bash: 'tree-sitter-bash.wasm'
});

function languageForPath(relativePath) {
  return EXTENSION_LANGUAGE.get(path.extname(String(relativePath || '')).toLowerCase()) || 'text';
}

function wasmForLanguage(language) {
  return WASM_BY_LANGUAGE[String(language || '').toLowerCase()] || null;
}

function isTestPath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').toLowerCase();
  const leaf = path.posix.basename(normalized);
  return normalized.startsWith('test/') || normalized.startsWith('tests/') || normalized.startsWith('__tests__/')
    || normalized.includes('/test/') || normalized.includes('/tests/') || normalized.includes('/__tests__/')
    || /(?:^|[._-])(?:test|spec)(?:[._-]|$)/.test(leaf)
    || /_test\.(?:go|py)$/.test(leaf)
    || /^test_.*\.py$/.test(leaf);
}

function queryTerms(value, limit = 32) {
  const expanded = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_$]+/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase();
  return [...new Set(expanded.split(/\s+/).filter(term => term.length >= 2))].slice(0, limit);
}

function lexicalSearchText(relativePath, source, symbols = []) {
  const symbolText = symbols.map(symbol => `${symbol.name} ${symbol.qualifiedName || ''}`).join(' ');
  return queryTerms(`${relativePath} ${symbolText} ${source}`, MAX_SEARCH_TERMS).join(' ');
}

function simpleSymbol(symbol) {
  const value = String(symbol || '');
  return value.split(/[.:#-]/).filter(Boolean).at(-1) || value;
}

function stripQuotes(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) || (text.startsWith('`') && text.endsWith('`')))) {
    return text.slice(1, -1);
  }
  return text;
}

export {
  EXTENSION_LANGUAGE,
  MAX_SEARCH_TERMS,
  PARSER_VERSION,
  WASM_BY_LANGUAGE,
  isTestPath,
  languageForPath,
  lexicalSearchText,
  queryTerms,
  simpleSymbol,
  stripQuotes,
  wasmForLanguage
};