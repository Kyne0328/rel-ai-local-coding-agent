import { fetchJson, postJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { esc } from '../../utils.js';

const SCOPES = Object.freeze([
  { id: 'built-in', label: 'Built-in' },
  { id: 'installed', label: 'Installed' },
  { id: 'workspace', label: 'Workspace enabled' }
]);

let activeScope = 'installed';
let library = null;
let preview = null;
let previewSelection = new Set();
let selectedWorkspace = '';
let pending = false;

export function mountSkills(container) {
  container.innerHTML = '<div class="settings-loading">Loading skills.</div>';
  return loadSkills(container);
}

async function loadSkills(container) {
  const payload = await fetchJson('/api/skills', { cache: 'no-store' });
  if (!payload?.ok) {
    container.innerHTML = `<div class="empty">${esc(payload?.error || 'Skills could not be loaded.')}</div>`;
    return;
  }
  library = payload;
  if (!selectedWorkspace || !workspaceByAlias(selectedWorkspace)) {
    selectedWorkspace = payload.workspaces?.[0]?.alias || '';
  }
  render(container);
}

function render(container) {
  if (!library) return;
  container.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'skills-page';
  container.appendChild(page);
  page.appendChild(skillsHeader(
    'Skills',
    'Install reusable agent skills once, then choose which skills are enabled for each workspace.'
  ));

  const scopes = document.createElement('div');
  scopes.className = 'skill-scope-tabs';
  scopes.setAttribute('role', 'tablist');
  for (const scope of SCOPES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `secondary skill-scope-tab${activeScope === scope.id ? ' active' : ''}`;
    button.textContent = scope.label;
    button.dataset.skillScope = scope.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(activeScope === scope.id));
    button.onclick = () => {
      activeScope = scope.id;
      render(container);
    };
    scopes.appendChild(button);
  }
  page.appendChild(scopes);

  const body = document.createElement('div');
  body.className = 'skill-settings-body';
  if (activeScope === 'built-in') renderBuiltIn(body);
  else if (activeScope === 'workspace') renderWorkspaceEnabled(body, container);
  else renderInstalled(body, container);
  page.appendChild(body);
}

function renderBuiltIn(body) {
  body.appendChild(sectionIntro(
    'Built-in skills',
    'These skills ship with Rel.AI and can be enabled for any workspace.'
  ));
  body.appendChild(skillList(library.builtIn || [], { empty: 'No built-in skills were found.' }));
}

function renderInstalled(body, container) {
  const installer = document.createElement('section');
  installer.className = 'card skill-install-card';
  installer.innerHTML = `
    <div class="card-head"><div><h3>Install from GitHub</h3><p>Add a public GitHub repository, then install all detected skills or only the ones you select.</p></div></div>
    <div class="card-body skill-install-body">
      <form class="skill-github-form" data-skill-github-form>
        <label for="skillGithubUrl">GitHub repository</label>
        <div class="skill-github-row">
          <input id="skillGithubUrl" name="repositoryUrl" type="url" spellcheck="false" autocomplete="off" placeholder="https://github.com/owner/repository" required>
          <button class="secondary" type="submit" ${pending ? 'disabled' : ''}>Load skills</button>
        </div>
      </form>
      <div class="skill-preview-host" data-skill-preview></div>
    </div>`;
  installer.querySelector('[data-skill-github-form]').onsubmit = event => {
    event.preventDefault();
    const input = installer.querySelector('input[name="repositoryUrl"]');
    void loadGitHubPreview(container, input.value);
  };
  body.appendChild(installer);
  renderPreview(installer.querySelector('[data-skill-preview]'), container);

  body.appendChild(sectionIntro(
    'Installed skills',
    'Installed skills are stored in the Rel.AI skill library and can be enabled in more than one workspace.'
  ));
  body.appendChild(skillList(library.installed || [], {
    empty: 'No GitHub skills are installed yet.',
    removable: true,
    onRemove: skill => void removeSkill(container, skill)
  }));
}

function renderPreview(host, container) {
  if (!preview) {
    host.innerHTML = '<div class="skill-preview-empty">Load a repository to choose which skills to install.</div>';
    return;
  }
  const skills = Array.isArray(preview.skills) ? preview.skills : [];
  if (!skills.length) {
    host.innerHTML = `<div class="empty">No skills were detected in ${esc(preview.repository || 'this repository')}.</div>`;
    return;
  }
  const selectedCount = skills.filter(skill => previewSelection.has(skill.key)).length;
  host.innerHTML = `
    <div class="skill-preview-head">
      <div><strong>${esc(preview.repository || 'Repository skills')}</strong><span>${skills.length} detected · ${selectedCount} selected</span></div>
      <label class="skill-select-all"><input type="checkbox" data-skill-select-all ${selectedCount === skills.length ? 'checked' : ''}> Select all</label>
    </div>
    <div class="skill-choice-list">
      ${skills.map(skill => skillChoiceHtml(skill, previewSelection.has(skill.key), 'preview')).join('')}
    </div>
    <div class="skill-preview-actions">
      <button type="button" data-install-selected ${!selectedCount || pending ? 'disabled' : ''}>Install selected</button>
    </div>`;
  host.querySelector('[data-skill-select-all]').onchange = event => {
    previewSelection = event.target.checked ? new Set(skills.map(skill => skill.key)) : new Set();
    renderPreview(host, container);
  };
  host.querySelectorAll('[data-preview-skill]').forEach(input => {
    input.onchange = () => {
      if (input.checked) previewSelection.add(input.value);
      else previewSelection.delete(input.value);
      renderPreview(host, container);
    };
  });
  host.querySelector('[data-install-selected]').onclick = () => void installSelected(container);
}

function renderWorkspaceEnabled(body, container) {
  body.appendChild(sectionIntro(
    'Workspace enabled skills',
    'Choose a workspace, then enable any built-in or installed skills it should use.'
  ));
  if (!(library.workspaces || []).length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Add a workspace before assigning skills.';
    body.appendChild(empty);
    return;
  }

  const card = document.createElement('section');
  card.className = 'card skill-workspace-card';
  const available = allAvailableSkills();
  const workspace = workspaceByAlias(selectedWorkspace) || library.workspaces[0];
  selectedWorkspace = workspace.alias;
  const enabled = new Set(workspace.skills || []);
  card.innerHTML = `
    <div class="card-head skill-workspace-head">
      <div><h3>Workspace</h3><p>Skill assignments are independent for each configured project.</p></div>
      <select data-skill-workspace aria-label="Workspace">${library.workspaces.map(item => `<option value="${esc(item.alias)}" ${item.alias === workspace.alias ? 'selected' : ''}>${esc(item.alias)}</option>`).join('')}</select>
    </div>
    <div class="card-body skill-workspace-body">
      <div class="skill-choice-list">
        ${available.length ? available.map(skill => skillChoiceHtml(skill, enabled.has(skill.id), 'workspace')).join('') : '<div class="empty">No skills are available.</div>'}
      </div>
      <div class="skill-preview-actions"><button type="button" data-save-workspace-skills ${pending ? 'disabled' : ''}>Save workspace skills</button></div>
    </div>`;
  card.querySelector('[data-skill-workspace]').onchange = event => {
    selectedWorkspace = event.target.value;
    render(container);
  };
  card.querySelector('[data-save-workspace-skills]').onclick = () => {
    const skills = [...card.querySelectorAll('[data-workspace-skill]:checked')].map(input => input.value);
    void saveWorkspaceSkills(container, workspace.alias, skills);
  };
  body.appendChild(card);
}

async function loadGitHubPreview(container, repositoryUrl) {
  if (pending) return;
  pending = true;
  render(container);
  try {
    const result = await postJson('/api/skills', { action: 'preview_github', repositoryUrl }, { timeout: 70_000 });
    if (!result?.ok) throw new Error(result?.error || 'GitHub skills could not be loaded.');
    preview = result;
    previewSelection = new Set((result.skills || []).map(skill => skill.key));
    toast(result.skills?.length ? `Found ${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}.` : 'No skills were detected in that repository.', { variant: result.skills?.length ? 'success' : 'info' });
  } catch (error) {
    preview = null;
    previewSelection = new Set();
    toast(messageOf(error), { variant: 'error' });
  } finally {
    pending = false;
    render(container);
  }
}

async function installSelected(container) {
  if (pending || !preview || !previewSelection.size) return;
  pending = true;
  render(container);
  try {
    const result = await postJson('/api/skills', {
      action: 'install_github',
      repositoryUrl: preview.repositoryUrl,
      selectedKeys: [...previewSelection]
    }, { timeout: 70_000 });
    if (!result?.ok) throw new Error(result?.error || 'Selected skills could not be installed.');
    library = result;
    preview = null;
    previewSelection = new Set();
    toast(`${result.installedNow?.length || 0} skill${result.installedNow?.length === 1 ? '' : 's'} installed.`, { variant: 'success' });
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
  } finally {
    pending = false;
    render(container);
  }
}

async function saveWorkspaceSkills(container, workspace, skills) {
  if (pending) return;
  pending = true;
  render(container);
  try {
    const result = await postJson('/api/skills', { action: 'set_workspace_skills', workspace, skills });
    if (!result?.ok) throw new Error(result?.error || 'Workspace skills could not be saved.');
    library = result;
    toast(`Skills saved for ${workspace}.`, { variant: 'success' });
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
  } finally {
    pending = false;
    render(container);
  }
}

async function removeSkill(container, skill) {
  if (pending) return;
  pending = true;
  render(container);
  try {
    const result = await postJson('/api/skills', { action: 'remove_installed', skillId: skill.id });
    if (!result?.ok) throw new Error(result?.error || 'Installed skill could not be removed.');
    library = result;
    toast(`${skill.name} removed.`, { variant: 'success' });
  } catch (error) {
    toast(messageOf(error), { variant: 'error' });
  } finally {
    pending = false;
    render(container);
  }
}

function skillList(skills, { empty, removable = false, onRemove } = {}) {
  const list = document.createElement('div');
  list.className = 'skill-library-list';
  if (!skills.length) {
    list.innerHTML = `<div class="empty">${esc(empty || 'No skills found.')}</div>`;
    return list;
  }
  for (const skill of skills) {
    const row = document.createElement('article');
    row.className = 'skill-library-row';
    row.innerHTML = `
      <div class="skill-library-copy">
        <div class="skill-library-title"><strong>${esc(skill.name)}</strong><span>${esc(skill.scope === 'built-in' ? 'Built-in' : skill.repository || 'Installed')}</span></div>
        <p>${esc(skill.description || 'No description provided.')}</p>
        ${skill.skillPath ? `<code>${esc(skill.skillPath)}</code>` : ''}
      </div>
      ${removable ? '<button class="secondary danger" type="button" data-remove-skill>Remove</button>' : ''}`;
    if (removable) row.querySelector('[data-remove-skill]').onclick = () => onRemove?.(skill);
    list.appendChild(row);
  }
  return list;
}

function skillChoiceHtml(skill, checked, kind) {
  const value = kind === 'preview' ? skill.key : skill.id;
  const data = kind === 'preview' ? 'data-preview-skill' : 'data-workspace-skill';
  return `<label class="skill-choice">
    <input type="checkbox" ${data} value="${esc(value)}" ${checked ? 'checked' : ''}>
    <span><strong>${esc(skill.name)}</strong><small>${esc(skill.description || skill.skillPath || 'No description provided.')}</small></span>
  </label>`;
}

function skillsHeader(title, copy) {
  const header = document.createElement('div');
  header.className = 'skills-header';
  header.innerHTML = `<h2>${esc(title)}</h2><p>${esc(copy)}</p>`;
  return header;
}

function sectionIntro(title, copy) {
  const section = document.createElement('div');
  section.className = 'skill-section-intro';
  section.innerHTML = `<strong>${esc(title)}</strong><span>${esc(copy)}</span>`;
  return section;
}

function allAvailableSkills() {
  return [...(library?.builtIn || []), ...(library?.installed || [])]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function workspaceByAlias(alias) {
  return (library?.workspaces || []).find(workspace => workspace.alias === alias) || null;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Skill library action failed.');
}
