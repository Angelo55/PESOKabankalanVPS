const { test } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const aiClient = require('../services/aiClient');

/**
 * aiClient.chatRaw — the tool-calling entrypoint added in Phase A of the public
 * visitor-support chatbot (docs/public-visitor-chatbot-proposal.md).
 *
 * Locks the contract that makes DeepSeek function calling possible without
 * disturbing the existing content-only callers:
 *   - chatRaw returns the FULL assistant message (tool_calls survive; a tool-call
 *     reply legitimately has content:null and must NOT be treated as empty);
 *   - chat()/chatDetailed() still return only the text over the SAME failover loop;
 *   - a truly empty reply (no content AND no tool_calls) still fails over / throws.
 *
 * Runtime-tested with a mocked axios — aiClient requires only axios (no db, no real
 * network), so unlike the db-touching services this can safely execute (§13).
 */

// Deterministic single-provider path: only DeepSeek configured.
process.env.DEEPSEEK_API_KEY = 'test-key';
delete process.env.OPENROUTER_API_KEY;

const okResponse = (message) => ({ data: { model: 'deepseek-chat', choices: [{ message }] } });

test('chatRaw returns the full message with tool_calls (content:null is valid)', async (t) => {
	const toolMsg = {
		role: 'assistant',
		content: null,
		tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_vacancies', arguments: '{"keyword":"driver"}' } }],
	};
	t.mock.method(axios, 'post', async () => okResponse(toolMsg));

	const out = await aiClient.chatRaw({ messages: [{ role: 'user', content: 'jobs?' }], prefer: 'deepseek', extra: { tools: [] } });
	assert.strictEqual(out.provider, 'deepseek');
	assert.strictEqual(out.model, 'deepseek-chat');
	assert.ok(out.message, 'returns the raw message object');
	assert.strictEqual(out.message.content, null, 'a tool-call reply keeps content:null');
	assert.strictEqual(out.message.tool_calls[0].function.name, 'search_vacancies', 'tool_calls are preserved');
});

test('chatDetailed and chat stay content-only over the same loop', async (t) => {
	t.mock.method(axios, 'post', async () => okResponse({ role: 'assistant', content: 'Hello there.' }));

	const detailed = await aiClient.chatDetailed({ messages: [{ role: 'user', content: 'hi' }], prefer: 'deepseek' });
	assert.strictEqual(detailed.content, 'Hello there.');
	assert.strictEqual(detailed.provider, 'deepseek');
	assert.ok(!('message' in detailed), 'chatDetailed does not leak the raw message');

	const str = await aiClient.chat({ messages: [{ role: 'user', content: 'hi' }], prefer: 'deepseek' });
	assert.strictEqual(str, 'Hello there.', 'chat() returns the content string');
});

test('a truly empty reply (no content, no tool_calls) throws AiError', async (t) => {
	t.mock.method(axios, 'post', async () => okResponse({ role: 'assistant', content: '' }));
	await assert.rejects(
		() => aiClient.chatRaw({ messages: [{ role: 'user', content: 'x' }], prefer: 'deepseek' }),
		(e) => e instanceof aiClient.AiError,
		'an empty provider reply must surface as AiError, not a fabricated result',
	);
});

test('chatRaw is exported alongside the existing entrypoints', () => {
	assert.strictEqual(typeof aiClient.chatRaw, 'function');
	assert.strictEqual(typeof aiClient.chat, 'function');
	assert.strictEqual(typeof aiClient.chatDetailed, 'function');
});
