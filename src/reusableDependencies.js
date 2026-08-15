const REUSABLE_DEPENDENCY_ROOTS = Object.freeze(['node_modules', 'electron/node_modules']);

function isReusableDependencyPath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  return REUSABLE_DEPENDENCY_ROOTS.some(root => normalized === root || normalized.startsWith(`${root}/`));
}

export { REUSABLE_DEPENDENCY_ROOTS, isReusableDependencyPath };
