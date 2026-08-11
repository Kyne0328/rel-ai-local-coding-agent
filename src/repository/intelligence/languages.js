import path from 'node:path';

const PARSER_VERSION = 22;
const MAX_SEARCH_TERMS = 768;

const LANGUAGE_PROFILES = Object.freeze([
  profile('bash', 'tree-sitter-bash.wasm', ['.sh', '.bash', '.zsh'], ['.bashrc', '.zshrc']),
  profile('c', 'tree-sitter-c.wasm', ['.c', '.h']),
  profile('csharp', 'tree-sitter-c_sharp.wasm', ['.cs'], [], 'csharp'),
  profile('cpp', 'tree-sitter-cpp.wasm', ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.ipp', '.tpp']),
  profile('css', 'tree-sitter-css.wasm', ['.css']),
  profile('dart', 'tree-sitter-dart.wasm', ['.dart']),
  profile('elisp', 'tree-sitter-elisp.wasm', ['.el']),
  profile('elixir', 'tree-sitter-elixir.wasm', ['.ex', '.exs']),
  profile('elm', 'tree-sitter-elm.wasm', ['.elm']),
  profile('embedded_template', 'tree-sitter-embedded_template.wasm', ['.erb']),
  profile('go', 'tree-sitter-go.wasm', ['.go'], [], 'go'),
  profile('html', 'tree-sitter-html.wasm', ['.html', '.htm']),
  profile('hcl', 'tree-sitter-hcl.wasm', ['.hcl']),
  profile('java', 'tree-sitter-java.wasm', ['.java'], [], 'java'),
  profile('javascript', 'tree-sitter-javascript.wasm', ['.js', '.jsx', '.mjs', '.cjs'], [], 'javascript-typescript'),
  profile('json', 'tree-sitter-json.wasm', ['.json']),
  profile('kotlin', 'tree-sitter-kotlin.wasm', ['.kt', '.kts']),
  profile('lua', 'tree-sitter-lua.wasm', ['.lua']),
  profile('objc', 'tree-sitter-objc.wasm', ['.m', '.mm']),
  profile('ocaml', 'tree-sitter-ocaml.wasm', ['.ml', '.mli']),
  profile('php', 'tree-sitter-php.wasm', ['.php', '.phtml']),
  profile('python', 'tree-sitter-python.wasm', ['.py', '.pyi'], [], 'python'),
  profile('ql', 'tree-sitter-ql.wasm', ['.ql', '.qll']),
  profile('rescript', 'tree-sitter-rescript.wasm', ['.res', '.resi']),
  profile('ruby', 'tree-sitter-ruby.wasm', ['.rb', '.rake', '.gemspec'], ['gemfile', 'rakefile']),
  profile('rust', 'tree-sitter-rust.wasm', ['.rs']),
  profile('scala', 'tree-sitter-scala.wasm', ['.scala', '.sc']),
  profile('solidity', 'tree-sitter-solidity.wasm', ['.sol']),
  profile('swift', 'tree-sitter-swift.wasm', ['.swift']),
  profile('terraform', 'tree-sitter-terraform.wasm', ['.tf', '.tfvars']),
  profile('systemrdl', 'tree-sitter-systemrdl.wasm', ['.rdl']),
  profile('tlaplus', 'tree-sitter-tlaplus.wasm', ['.tla']),
  profile('toml', 'tree-sitter-toml.wasm', ['.toml']),
  profile('tsx', 'tree-sitter-tsx.wasm', ['.tsx'], [], 'javascript-typescript'),
  profile('typescript', 'tree-sitter-typescript.wasm', ['.ts', '.mts', '.cts'], [], 'javascript-typescript'),
  profile('vue', 'tree-sitter-vue.wasm', ['.vue']),
  profile('yaml', 'tree-sitter-yaml.wasm', ['.yaml', '.yml']),
  profile('sql', 'tree-sitter-sql.wasm', [".sql"]),
  profile('powershell', 'tree-sitter-powershell.wasm', [".ps1",".psm1",".psd1"]),
  profile('markdown', 'tree-sitter-markdown.wasm', [".md",".markdown",".mdx"]),
  profile('dockerfile', 'tree-sitter-dockerfile.wasm', [".dockerfile"], ["dockerfile"]),
  profile('graphql', 'tree-sitter-graphql.wasm', [".graphql",".gql"]),
  profile('protobuf', 'tree-sitter-proto.wasm', [".proto"]),
  profile('r', 'tree-sitter-r.wasm', [".r"]),
  profile('assembly', 'tree-sitter-asm.wasm', [".asm",".s"]),
  profile('gdscript', 'tree-sitter-gdscript.wasm', [".gd"]),
  profile('nix', 'tree-sitter-nix.wasm', [".nix"]),
  profile('haskell', 'tree-sitter-haskell.wasm', [".hs",".lhs"]),
  profile('julia', 'tree-sitter-julia.wasm', [".jl"]),
  profile('clojure', 'tree-sitter-clojure.wasm', [".clj",".cljs",".cljc",".edn"]),
  profile('groovy', 'tree-sitter-groovy.wasm', [".groovy",".gradle"]),
  profile('perl', 'tree-sitter-perl.wasm', [".pl",".pm",".t"]),
  profile('zig', 'tree-sitter-zig.wasm', ['.zig'])
]);

const PROFILE_BY_LANGUAGE = new Map(LANGUAGE_PROFILES.map(item => [item.language, item]));
const EXTENSION_LANGUAGE = new Map();
const BASENAME_LANGUAGE = new Map();
for (const item of LANGUAGE_PROFILES) {
  for (const extension of item.extensions) EXTENSION_LANGUAGE.set(extension, item.language);
  for (const basename of item.basenames) BASENAME_LANGUAGE.set(basename, item.language);
}
const WASM_BY_LANGUAGE = Object.freeze(Object.fromEntries(LANGUAGE_PROFILES.map(item => [item.language, item.wasm])));
const VENDORED_WASM_BY_LANGUAGE = Object.freeze({
  hcl: 'vendor/tree-sitter/hcl/tree-sitter-hcl.wasm',
  terraform: 'vendor/tree-sitter/terraform/tree-sitter-terraform.wasm',
  sql: 'vendor/tree-sitter/sql/tree-sitter-sql.wasm',
  powershell: 'vendor/tree-sitter/powershell/tree-sitter-powershell.wasm',
  markdown: 'vendor/tree-sitter/markdown/tree-sitter-markdown.wasm',
  dockerfile: 'vendor/tree-sitter/dockerfile/tree-sitter-dockerfile.wasm',
  graphql: 'vendor/tree-sitter/graphql/tree-sitter-graphql.wasm',
  protobuf: 'vendor/tree-sitter/protobuf/tree-sitter-proto.wasm',
  r: 'vendor/tree-sitter/r/tree-sitter-r.wasm',
  assembly: 'vendor/tree-sitter/assembly/tree-sitter-asm.wasm',
  gdscript: 'vendor/tree-sitter/gdscript/tree-sitter-gdscript.wasm',
  nix: 'vendor/tree-sitter/nix/tree-sitter-nix.wasm',
  haskell: 'vendor/tree-sitter/haskell/tree-sitter-haskell.wasm',
  julia: 'vendor/tree-sitter/julia/tree-sitter-julia.wasm',
  clojure: 'vendor/tree-sitter/clojure/tree-sitter-clojure.wasm',
  groovy: 'vendor/tree-sitter/groovy/tree-sitter-groovy.wasm',
  perl: 'vendor/tree-sitter/perl/tree-sitter-perl.wasm'
});

function profile(language, wasm, extensions, basenames = [], resolver = null) {
  return Object.freeze({ language, wasm, extensions: Object.freeze([...extensions]), basenames: Object.freeze([...basenames]), resolver });
}

function languageForPath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').toLowerCase();
  const basename = path.posix.basename(normalized);
  return BASENAME_LANGUAGE.get(basename) || EXTENSION_LANGUAGE.get(path.posix.extname(basename)) || 'text';
}

function wasmForLanguage(language) {
  return WASM_BY_LANGUAGE[String(language || '').toLowerCase()] || null;
}

function parserForLanguage(language) {
  const key = String(language || '').toLowerCase();
  const vendored = VENDORED_WASM_BY_LANGUAGE[key];
  if (vendored) return { path: vendored, provider: 'vendored-tree-sitter-wasm' };
  const wasm = WASM_BY_LANGUAGE[key];
  return wasm ? { path: `node_modules/tree-sitter-wasms/out/${wasm}`, provider: 'tree-sitter-wasms' } : null;
}

function languageProfile(language) {
  return PROFILE_BY_LANGUAGE.get(String(language || '').toLowerCase()) || null;
}

function structuralLanguages() {
  return LANGUAGE_PROFILES.map(item => item.language);
}

function enhancedResolverLanguages() {
  return LANGUAGE_PROFILES.filter(item => item.resolver).map(item => item.language);
}

function languageCapabilities(language) {
  const item = languageProfile(language);
  if (!item) return { language: String(language || 'text'), structural: false, parser: null, resolver: null, resolution: 'lexical' };
  return { language: item.language, structural: true, parser: item.wasm, resolver: item.resolver, resolution: item.resolver ? 'enhanced' : 'structural' };
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
  const expanded = String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_$]+/g, ' ').replace(/[^A-Za-z0-9]+/g, ' ').toLowerCase();
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
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) || (text.startsWith('`') && text.endsWith('`')))) return text.slice(1, -1);
  return text;
}

export {
  EXTENSION_LANGUAGE, LANGUAGE_PROFILES, MAX_SEARCH_TERMS, PARSER_VERSION, WASM_BY_LANGUAGE,
  enhancedResolverLanguages, isTestPath, languageCapabilities, languageForPath, languageProfile,
  lexicalSearchText, parserForLanguage, queryTerms, simpleSymbol, structuralLanguages, stripQuotes, wasmForLanguage
};
