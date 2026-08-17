import { get as getStore } from '../../store.js';
import { toast } from '../../components/toast.js';
import { header, panel } from './shared.js';

export function mountAbout(container) {
  const metadata = getStore().application || {};
  container.innerHTML = '';
  container.appendChild(header(
    'About Rel.AI',
    'Rel.AI lets ChatGPT work with your local code projects while files and commands stay on your computer.'
  ));

  const information = panel('Application information');
  information.body.appendChild(productSummary(metadata));
  information.body.appendChild(developerRow(metadata.developer || {}));
  information.body.appendChild(linkRow(
    'Source code',
    repositoryLabel(metadata.repositoryUrl),
    metadata.repositoryUrl,
    'Rel.AI MCP source code on GitHub'
  ));
  information.body.appendChild(valueRow('License', metadata.license));
  container.appendChild(information.el);

  if (typeof window.relaiDesktop?.quitApp === 'function') {
    const controls = panel('Application controls');
    controls.body.appendChild(quitRow());
    container.appendChild(controls.el);
  }
}

function quitRow() {
  const row = detailRow('Quit Rel.AI MCP', 'Stop the local connection and close Rel.AI completely.');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = 'Quit Rel.AI MCP';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Quitting…';
    try {
      await window.relaiDesktop.quitApp();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Quit Rel.AI MCP';
      toast(error instanceof Error ? error.message : String(error || 'Rel.AI could not quit.'), { variant: 'error' });
    }
  });
  row.appendChild(button);
  return row;
}

function productSummary(metadata) {
  const product = document.createElement('div');
  product.className = 'about-product';
  const logo = document.createElement('img');
  logo.src = '/public/assets/relai-logo.png';
  logo.width = 193;
  logo.height = 187;
  logo.alt = '';
  logo.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  const name = document.createElement('h4');
  name.textContent = metadata.name;
  const version = document.createElement('p');
  version.textContent = `Version ${metadata.version}`;
  copy.append(name, version);
  product.append(logo, copy);
  return product;
}

function developerRow(developer) {
  const row = detailRow('Developer');
  const value = document.createElement('span');
  value.className = 'about-detail-value';
  value.append('Developed by ');
  const link = githubLink(
    developer.profileUrl,
    developer.name,
    `${developer.name} on GitHub (@${developer.username})`
  );
  if (link) value.appendChild(link);
  else value.append(developer.name);
  if (developer.username) value.append(` (@${developer.username})`);
  row.appendChild(value);
  return row;
}

function linkRow(label, text, href, accessibleName) {
  const row = detailRow(label);
  const link = githubLink(href, text, accessibleName);
  if (link) row.appendChild(link);
  else row.appendChild(valueElement(text));
  return row;
}

function valueRow(label, value) {
  const row = detailRow(label);
  row.appendChild(valueElement(value));
  return row;
}

function detailRow(label, description = '') {
  const row = document.createElement('div');
  row.className = 'setting-row about-detail-row';
  const copy = document.createElement('div');
  copy.className = 'setting-row-copy';
  const heading = document.createElement('strong');
  heading.textContent = label;
  copy.appendChild(heading);
  if (description) {
    const help = document.createElement('span');
    help.textContent = description;
    copy.appendChild(help);
  }
  row.appendChild(copy);
  return row;
}

function valueElement(value) {
  const element = document.createElement('span');
  element.className = 'about-detail-value';
  element.textContent = String(value || '');
  return element;
}

function githubLink(value, label, accessibleName) {
  const href = validatedGitHubUrl(value);
  if (!href) return null;
  const link = document.createElement('a');
  link.className = 'settings-external-link about-detail-value';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = String(label || href);
  link.setAttribute('aria-label', accessibleName);
  return link;
}

function validatedGitHubUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

function repositoryLabel(value) {
  const href = validatedGitHubUrl(value);
  if (!href) return String(value || '');
  return new URL(href).pathname.replace(/^\/+|\/+$/g, '');
}
