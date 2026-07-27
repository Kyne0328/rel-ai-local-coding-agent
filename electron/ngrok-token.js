'use strict';

function normalizeNgrokAuthtoken(value) {
  const token = String(value || '').trim();
  if (!token) throw new Error('ngrok authtoken is required.');
  if (/\s/.test(token)) throw new Error('ngrok authtoken cannot contain spaces.');
  if (token.length < 8) throw new Error('ngrok authtoken is too short.');
  return token;
}

module.exports = { normalizeNgrokAuthtoken };
