const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for per-viewer conversation state in the Messages Hub — mute, pin (max 5),
 * and mark read/unread (single + batch). Source-only (no DB: require('../db') runs
 * initDB, §13). Locks the server-side pin cap, participant scoping, the muted-count
 * exclusion, and the pinned-first ordering.
 */

const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'messageRoutes.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '050_conversation_states_and_referral_prefs.sql'), 'utf8');

test('conversation_states is created (migration 050 + zero-crash boot create)', () => {
	assert.match(MIG, /CREATE TABLE IF NOT EXISTS conversation_states/, 'canonical schema');
	assert.match(MIG, /PRIMARY KEY \(user_id, conversation_id\)/, 'per-viewer, per-conversation key');
	assert.match(ROUTES, /CREATE TABLE IF NOT EXISTS conversation_states/, 'boot create so a deploy is never ahead of the migration');
});

test('the 5-pin cap is enforced SERVER-SIDE inside a transaction', () => {
	// The cap is now sourced from the central quota catalogue (config/quotas.js) so
	// it stays in lockstep with the /usage indicator; config/quotas asserts it === 5.
	assert.match(ROUTES, /MAX_PINNED\s*=\s*require\('\.\.\/config\/quotas'\)\.LIMITS\.PINNED_CONVERSATIONS/, 'the cap constant comes from the catalogue');
	assert.match(ROUTES, /pins >= MAX_PINNED/, 'the cap is checked');
	assert.match(ROUTES, /PIN_LIMIT/, 'a clear 409 code is returned on the 6th pin');
	assert.match(ROUTES, /COUNT\(\*\) AS pins FROM conversation_states WHERE user_id = \? AND pinned_at IS NOT NULL/, 'the count is transactional so concurrent pins cannot both pass');
});

test('every state mutation is scoped to a participant (no touching a stranger conversation)', () => {
	assert.match(ROUTES, /async function loadParticipantConversation/, 'participant guard exists');
	assert.match(ROUTES, /peso_admin_id !== userId && conv\.applicant_id !== userId/, 'the guard checks both sides');
	// The batch endpoint re-scopes the ids to the viewer's own conversations.
	assert.match(ROUTES, /WHERE id IN \(\$\{placeholders\}\) AND \(peso_admin_id = \? OR applicant_id = \?\)/, 'batch scopes to owned conversations');
});

test('batch read/unread is ONE controlled request (not one-per-row) and validated', () => {
	assert.match(ROUTES, /router\.post\('\/conversations\/state'/, 'batch endpoint exists');
	assert.match(ROUTES, /\['read', 'unread'\]\.includes\(action\)/, 'action is validated');
	assert.match(ROUTES, /\.slice\(0, 200\)/, 'the batch size is capped');
});

test('mute / pin endpoints exist and mute excludes the conversation from the unread count', () => {
	assert.match(ROUTES, /router\.patch\('\/:conversationId\/mute'/, 'mute endpoint');
	assert.match(ROUTES, /router\.patch\('\/:conversationId\/pin'/, 'pin endpoint');
	assert.match(ROUTES, /COALESCE\(cs\.is_muted, 0\) = 0/, 'the global unread count excludes muted conversations');
});

test('the roster returns state fields + unread count and orders pinned-first', () => {
	assert.match(ROUTES, /COALESCE\(cs\.is_muted, 0\) AS is_muted/, 'is_muted returned');
	assert.match(ROUTES, /cs\.pinned_at AS pinned_at/, 'pinned_at returned');
	assert.match(ROUTES, /COALESCE\(cs\.manually_unread, 0\) AS manually_unread/, 'manual-unread returned');
	assert.match(ROUTES, /AS unread_count/, 'per-viewer unread count returned');
	assert.match(ROUTES, /ORDER BY \(cs\.pinned_at IS NOT NULL\) DESC, cs\.pinned_at DESC, c\.last_message_at DESC/, 'pinned-first ordering');
});

test('opening a conversation clears the manual-unread flag too', () => {
	assert.match(ROUTES, /upsertConversationState\(req\.userId, Number\(req\.params\.conversationId\), \{ manually_unread: 0 \}\)/, 'GET history clears manual-unread');
});
