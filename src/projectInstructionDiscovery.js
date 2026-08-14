import * as fs from 'node:fs';
import * as path from 'node:path';

const AGENT_INSTRUCTION_NAMES = Object.freeze(['AGENTS.override.md', 'AGENTS.md']);

function discoverProjectInstructionPaths(root, requestedPath) {
  const target = resolveInstructionTarget(root, requestedPath);
  if (target.error) return target;
  const agentPaths = [];
  let directory = root;
  for (;;) {
    const selected = selectAgentInstruction(directory);
    if (selected) agentPaths.push(slashPath(path.relative(root, selected)));
    if (samePath(directory, target.directory)) break;
    const relativeTarget = path.relative(directory, target.directory);
    const nextSegment = relativeTarget.split(path.sep)[0];
    if (!nextSegment || nextSegment === '..') break;
    directory = path.join(directory, nextSegment);
  }
  return {
    ...target,
    instructionPaths: agentPaths.reverse()
  };
}

function resolveInstructionTarget(root, requestedPath) {
  const requested = String(requestedPath || '').trim();
  if (!requested) return { directory: root, relativeDirectory: '' };
  if (path.isAbsolute(requested)) return { error: 'Project instruction targetPath must be workspace-relative.' };
  const candidate = path.resolve(root, requested);
  if (!isPathInside(candidate, root)) return { error: 'Project instruction targetPath escapes the workspace.' };
  try {
    const realPath = fs.realpathSync(candidate);
    if (!isPathInside(realPath, root)) return { error: 'Project instruction targetPath escapes the workspace.' };
    const stat = fs.statSync(realPath);
    const directory = stat.isDirectory() ? realPath : path.dirname(realPath);
    return { directory, relativeDirectory: slashPath(path.relative(root, directory)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function selectAgentInstruction(directory) {
  for (const name of AGENT_INSTRUCTION_NAMES) {
    const candidate = path.join(directory, name);
    try {
      fs.lstatSync(candidate);
      return candidate;
    } catch {}
  }
  return '';
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function slashPath(value) {
  return String(value || '').split(path.sep).join('/');
}

export { discoverProjectInstructionPaths };
