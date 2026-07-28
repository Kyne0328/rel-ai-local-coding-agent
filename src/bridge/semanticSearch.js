

import * as crypto from "node:crypto";
import { loadIndex } from "./codeIntelligence.js";
import { clampNumber } from "./limits.js";

const CACHE = new Map();
const VECTOR_DIMENSIONS = 384;

function relaiSemanticSearch(workspace, _config, args = {}) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('relai_semantic_search requires query.');
  const maxResults = Math.floor(clampNumber(args.maxResults, 1, 100, 20));
  const loaded = loadIndex(workspace, args);
  const index = semanticIndex(loaded);
  const queryTokens = tokenize(query);
  const queryVector = vectorize(queryTokens);
  const pathFilter = String(args.pathPrefix || '').replaceAll('\\', '/').replace(/^\.\//, '');
  const language = String(args.language || '').toLowerCase();
  const ranked = [];
  for (const document of index.documents) {
    if (pathFilter && !document.path.startsWith(pathFilter)) continue;
    if (language && document.language.toLowerCase() !== language) continue;
    const semanticScore = cosine(queryVector, document.vector);
    const lexicalScore = bm25Like(queryTokens, document.tokens, index.documentFrequency, index.documents.length);
    const pathScore = queryTokens.reduce((score, token) => score + (document.pathLower.includes(token) ? 0.08 : 0), 0);
    const symbolScore = queryTokens.reduce((score, token) => score + (document.symbols.some(symbol => symbol.includes(token)) ? 0.12 : 0), 0);
    const score = semanticScore * 0.45 + lexicalScore * 0.35 + pathScore + symbolScore;
    if (score <= 0) continue;
    ranked.push({
      path: document.path,
      language: document.language,
      test: document.test,
      score: Number(score.toFixed(6)),
      reasons: scoreReasons(queryTokens, document, semanticScore, lexicalScore),
      snippets: bestSnippets(document, queryTokens, 3)
    });
  }
  ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return {
    ok: true,
    workspace: workspace.alias,
    query,
    strategy: 'local-hybrid-vector-lexical',
    neuralEmbeddings: false,
    privacy: 'All indexing and ranking run locally. No source text is sent to an external service.',
    fingerprint: loaded.fingerprint,
    cacheHit: index.cacheHit,
    results: ranked.slice(0, maxResults),
    resultCount: ranked.length,
    truncated: ranked.length > maxResults
  };
}

function semanticIndex(loaded) {
  const cached = CACHE.get(loaded.fingerprint);
  if (cached) return { ...cached, cacheHit: true };
  const documentFrequency = new Map();
  const documents = loaded.index.files.map(file => {
    const tokens = tokenize(`${file.path} ${file.definitions.map(item => item.name).join(' ')} ${file.lines.join('\n')}`);
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    return {
      path: file.path,
      pathLower: file.path.toLowerCase(),
      language: file.language,
      test: file.test,
      lines: file.lines,
      tokens,
      vector: vectorize(tokens),
      symbols: file.definitions.map(item => item.name.toLowerCase())
    };
  });
  const value = { documents, documentFrequency };
  CACHE.clear();
  CACHE.set(loaded.fingerprint, value);
  return { ...value, cacheHit: false };
}

function tokenize(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter(token => token.length >= 2)
    .slice(0, 200000);
}

function vectorize(tokens) {
  const vector = new Float64Array(VECTOR_DIMENSIONS);
  for (const token of tokens) {
    const digest = crypto.createHash('sha256').update(token).digest();
    const index = digest.readUInt16BE(0) % VECTOR_DIMENSIONS;
    const sign = digest[2] % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log(1 + token.length));
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

function cosine(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return Math.max(0, score);
}

function bm25Like(queryTokens, documentTokens, documentFrequency, documentCount) {
  if (!queryTokens.length || !documentTokens.length) return 0;
  const frequencies = new Map();
  for (const token of documentTokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  let score = 0;
  for (const token of new Set(queryTokens)) {
    const tf = frequencies.get(token) || 0;
    if (!tf) continue;
    const df = documentFrequency.get(token) || 0;
    const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
    score += idf * (tf / (tf + 1.2));
  }
  return Math.min(1, score / Math.max(1, new Set(queryTokens).size));
}

function bestSnippets(document, queryTokens, limit) {
  const scored = document.lines.map((text, index) => {
    const lower = text.toLowerCase();
    const matches = queryTokens.filter(token => lower.includes(token)).length;
    return { line: index + 1, text: text.trim().slice(0, 500), matches };
  }).filter(item => item.matches > 0);
  scored.sort((left, right) => right.matches - left.matches || left.line - right.line);
  return scored.slice(0, limit);
}

function scoreReasons(queryTokens, document, semanticScore, lexicalScore) {
  const reasons = [];
  if (semanticScore > 0.15) reasons.push('hashed-vector similarity');
  if (lexicalScore > 0) reasons.push('rare query terms');
  if (queryTokens.some(token => document.pathLower.includes(token))) reasons.push('path match');
  if (queryTokens.some(token => document.symbols.some(symbol => symbol.includes(token)))) reasons.push('symbol match');
  return reasons;
}

export { relaiSemanticSearch, tokenize, vectorize, cosine };
