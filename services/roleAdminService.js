/**
 * ROLE ADMINISTRATION — changing what someone is allowed to do.
 *
 * This is the most dangerous operation in the platform and the only one that
 * can permanently lock everyone out of it. Every rule below exists to stop a
 * specific, reachable failure.
 *
 * ── THE LOCKOUT ────────────────────────────────────────────────────────────
 * There are TWO Super Administrators in production. There is no seeding script,
 * no console, and no self-service path to become one: the ONLY way to create a
 * Super Administrator is for an existing Super Administrator to promote someone.
 *
 * So if both are demoted, the platform loses administrative access FOREVER, and
 * recovery means a manual UPDATE against production TiDB by whoever holds the
 * database credentials. `assertNotLastSuperAdmin` is what prevents that, and it
 * runs inside the transaction with the row locked — see below for why a plain
 * check-then-write is not enough.
 *
 * ── WHY THE COUNT IS TAKEN UNDER A LOCK ────────────────────────────────────
 * With exactly two Super Administrators, two simultaneous demotions each read
 * "count = 2, fine to proceed" and both commit, leaving zero. That is the
 * classic check-then-act race, and here it is unrecoverable rather than merely
 * annoying. SELECT ... FOR UPDATE on the super-administrator rows serialises the
 * two requests, so the second re-reads count = 1 and is refused.
 *
 * ── WHY THE AUDIT ENTRY IS INSIDE THE TRANSACTION ──────────────────────────
 * Everywhere else in this system, an audit or notification failure must never
 * fail the action it describes. Role changes invert that on purpose: a privilege
 * escalation that could not be recorded MUST NOT HAPPEN. If the audit write
 * fails, the whole change rolls back.
 *
 * ── WHAT IS DELIBERATELY NOT PREVENTED ─────────────────────────────────────
 * A Super Administrator CAN promote another account to Super Administrator.
 * That is the intended way to add one, and locking it down would leave no path
 * at all. It is audited, and it is the reason the audit entry is transactional.
 */

const pool = require('../db');
const { normalizeRole, getRoleLabel, ROLE_KEYS, ROLE_ALIASES } = require('../middleware/rbac');
const adminAudit = require('./adminAuditService');

class RoleAdminError extends Error {
	constructor(status, message) {
		super(message);
		this.name = 'RoleAdminError';
		this.status = status;
	}
}

/**
 * Roles a Super Administrator may assign.
 *
 * An allow-list, not a blocklist: an unrecognised value is refused rather than
 * written. users.role is a plain VARCHAR, so an unchecked string would be
 * accepted by the database and would then normalize to the JOB_SEEKER default
 * everywhere — silently stripping someone's access instead of failing loudly.
 */
const ASSIGNABLE_ROLES = [
	ROLE_KEYS.JOB_SEEKER,
	ROLE_KEYS.PESO_ADMINISTRATOR,
	ROLE_KEYS.PESO_STAFF,
	ROLE_KEYS.SUPER_ADMINISTRATOR,
];

/**
 * Refuses a change that would remove the last Super Administrator.
 *
 * MUST be called with `conn` inside a transaction, after the super-administrator
 * rows have been locked. Calling it on the pool would reintroduce the race it
 * exists to close.
 */
async function assertNotLastSuperAdmin({ targetId, currentRole, nextRole }, conn) {
	const losingSuperAdmin =
		currentRole === ROLE_KEYS.SUPER_ADMINISTRATOR &&
		nextRole !== ROLE_KEYS.SUPER_ADMINISTRATOR;

	if (!losingSuperAdmin) return;

	// Locks every super-administrator row for the duration of the transaction, so
	// a concurrent demotion cannot read a stale count.
	const [supers] = await conn.query(
		`SELECT id FROM users WHERE role = ? FOR UPDATE`,
		[ROLE_KEYS.SUPER_ADMINISTRATOR]
	);

	const remaining = supers.filter((row) => Number(row.id) !== Number(targetId)).length;

	if (remaining === 0) {
		throw new RoleAdminError(
			409,
			'This is the only Super Administrator account. Promote someone else first, otherwise no one will be able to administer the platform.'
		);
	}
}

/**
 * Changes one account's role.
 *
 * Returns { userId, name, previousRole, newRole } on success.
 */
async function changeUserRole({ targetUserId, nextRoleInput, actingAdminId, reason }) {
	// VALIDATE THE RAW INPUT, NOT THE NORMALIZED RESULT.
	//
	// normalizeRole() is lenient by design: it maps anything it does not
	// recognise to JOB_SEEKER so that a legacy or malformed stored value still
	// resolves to something. That is right for READING a role and completely
	// wrong for WRITING one — `normalizeRole('wizard')` returns 'applicant',
	// which then passes an allow-list check on the normalized value and quietly
	// demotes the account instead of failing.
	//
	// So the input has to be a recognised role token BEFORE normalization. A
	// mistyped role is now a 400, not a silent demotion.
	const rawKey = String(nextRoleInput || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
	const isRecognised = Object.prototype.hasOwnProperty.call(ROLE_ALIASES, rawKey);

	if (!isRecognised) {
		throw new RoleAdminError(400, 'That is not a role you can assign.');
	}

	const nextRole = normalizeRole(nextRoleInput);

	if (!ASSIGNABLE_ROLES.includes(nextRole)) {
		throw new RoleAdminError(400, 'That is not a role you can assign.');
	}

	// SELF-DEMOTION GUARD. Distinct from the last-admin guard: with two Super
	// Administrators, demoting yourself is allowed by the count check but is
	// almost always a misclick, and the person who did it can no longer undo it.
	// Refusing costs nothing — the other administrator can do it deliberately.
	if (Number(targetUserId) === Number(actingAdminId)) {
		throw new RoleAdminError(
			400,
			'You cannot change your own role. Ask another Super Administrator to do it.'
		);
	}

	const connection = await pool.getConnection();

	try {
		await connection.beginTransaction();

		const [rows] = await connection.query(
			'SELECT id, name, email, role FROM users WHERE id = ? FOR UPDATE',
			[targetUserId]
		);

		if (rows.length === 0) {
			throw new RoleAdminError(404, 'That account no longer exists.');
		}

		const target = rows[0];
		const currentRole = normalizeRole(target.role);

		if (currentRole === nextRole) {
			throw new RoleAdminError(409, `${target.name} already has that role.`);
		}

		await assertNotLastSuperAdmin({ targetId: target.id, currentRole, nextRole }, connection);

		await connection.query('UPDATE users SET role = ? WHERE id = ?', [nextRole, target.id]);

		// Transactional ON PURPOSE — see the header. A privilege change that
		// cannot be recorded must not happen.
		await adminAudit.record({
			adminId: actingAdminId,
			action: adminAudit.AUDIT_ACTIONS.ROLE_CHANGED,
			targetEntity: target.name || target.email,
			targetId: target.id,
			details: `Role changed from ${getRoleLabel(currentRole)} to ${getRoleLabel(nextRole)}.`
				+ (reason ? ` Reason: ${String(reason).slice(0, 300)}` : ''),
		}, connection);

		await connection.commit();

		console.log(`[RoleAdmin] Admin ${actingAdminId} changed user ${target.id} from ${currentRole} to ${nextRole}`);

		return {
			userId: target.id,
			name: target.name,
			previousRole: currentRole,
			previousRoleLabel: getRoleLabel(currentRole),
			newRole: nextRole,
			newRoleLabel: getRoleLabel(nextRole),
		};
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

/**
 * How many Super Administrators exist. Lets the UI warn BEFORE an action is
 * attempted rather than only rejecting it afterwards.
 */
async function countSuperAdmins() {
	const [[{ total }]] = await pool.query(
		'SELECT COUNT(*) AS total FROM users WHERE role = ?',
		[ROLE_KEYS.SUPER_ADMINISTRATOR]
	);
	return Number(total);
}

module.exports = { changeUserRole, countSuperAdmins, ASSIGNABLE_ROLES, RoleAdminError };
