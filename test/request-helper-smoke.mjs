import assert from "node:assert/strict";
import { makeDefaultConfig, normalizeConfig } from "../src/config.js";
import { publicRequestHelperConfig, renderUserscript } from "../src/chatgptRequestHelper.js";

const cfg = makeDefaultConfig();
assert.equal(cfg.chatgptRequestHelper.enabled, false);
assert.equal(cfg.chatgptRequestHelper.autoApprove, false);

const normalized = normalizeConfig({ chatgptRequestHelper: { enabled: true, autoApprove: true, maxClicksPerMinute: 3 } });
assert.equal(normalized.chatgptRequestHelper.enabled, true);
assert.equal(normalized.chatgptRequestHelper.autoApprove, true);
assert.equal(normalized.chatgptRequestHelper.maxClicksPerMinute, 3);

const payload = publicRequestHelperConfig(normalized);
assert.equal(payload.ok, true);
assert.equal(payload.config.enabled, true);

const script = renderUserscript(normalized, { baseUrl: "http://127.0.0.1:3333" });
assert.match(script, /@match\s+https:\/\/chatgpt\.com\/\*/);
assert.match(script, /Rel\.AI MCP ChatGPT Request Helper/);
assert.match(script, /maxClicksPerMinute/);
console.log("request-helper-smoke ok");
