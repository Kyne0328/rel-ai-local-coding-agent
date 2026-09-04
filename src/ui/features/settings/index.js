import { mountConnector } from './connector.js';
import { mountPreferences } from './general.js';
import { mountKnowledge } from './knowledge.js';
import { mountApplication } from './application.js';
import { mountAbout } from './about.js';

const MOUNTS = {
  connection: mountConnector,
  preferences: mountPreferences,
  memory: mountKnowledge,
  application: mountApplication,
  about: mountAbout
};

export function mountSettings(container, subPageId = 'preferences') {
  const currentSubPage = Object.hasOwn(MOUNTS, subPageId) ? subPageId : 'preferences';
  container.innerHTML = '';

  const content = document.createElement('div');
  content.id = '__settings-content';
  content.className = 'settings-content';
  container.appendChild(content);

  return MOUNTS[currentSubPage](content);
}
