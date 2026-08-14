import { mountGeneral } from './general.js';
import { mountApplication } from './application.js';
import { mountAbout } from './about.js';
import { SETTINGS_NAV_ITEMS } from '../../navigation-catalog.js';
import { navigate, routeHref } from '../../router.js';

const MOUNTS = {
  preferences: mountGeneral,
  application: mountApplication,
  about: mountAbout
};

let currentSubPage = 'preferences';

export function mountSettings(container, subPageId = 'preferences') {
  currentSubPage = Object.hasOwn(MOUNTS, subPageId) ? subPageId : 'preferences';
  container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'settings-layout settings-shell';
  const rail = document.createElement('nav');
  rail.className = 'settings-rail';
  rail.setAttribute('aria-label', 'Settings navigation');
  const content = document.createElement('div');
  content.id = '__settings-content';
  content.className = 'settings-content';

  for (const item of SETTINGS_NAV_ITEMS) {
    const pageId = item.id;
    const button = document.createElement('button');
    const active = pageId === currentSubPage;
    button.type = 'button';
    button.className = `secondary settings-nav-button${active ? ' active' : ''}`;
    button.textContent = item.label;
    button.dataset.subPage = pageId;
    if (active) button.setAttribute('aria-current', 'page');
    button.onclick = () => openPage(pageId, rail, content);
    rail.appendChild(button);
  }

  shell.append(rail, content);
  container.appendChild(shell);
  return MOUNTS[currentSubPage](content);
}

function openPage(pageId, rail, content) {
  const section = pageId === 'preferences' ? 'settings' : `settings/${pageId}`;
  const target = routeHref(section);
  if (location.hash !== target) {
    navigate(section);
    return;
  }
  currentSubPage = pageId;
  rail.querySelectorAll('button').forEach(button => {
    const active = button.dataset.subPage === pageId;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  content.innerHTML = '';
  MOUNTS[pageId](content);
}
