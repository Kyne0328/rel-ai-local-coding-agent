const RELEASE_NOTES = {
  version: '0.13.0',
  headline: 'Trusted workspace mode is now the default experience.',
  bullets: [
    'Once a session is active, the agent reads, edits, and validates with continuity.',
    'Repeated reads of the same file return cached content within a session.',
    'Read budgets scale automatically while a session is active (multiplier configurable).',
    'Validation level is selected proportionally to change surface.'
  ]
};

function getReleaseNotes() {
  return { ...RELEASE_NOTES, bullets: RELEASE_NOTES.bullets.slice() };
}

module.exports = { getReleaseNotes };
