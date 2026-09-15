/**
 * Backfills referral letter PDFs from storage/referrals/ into the
 * referral_letter_files table (migration 021).
 *
 * WHY THIS EXISTS: letters issued before 021 live only on disk, and on Render
 * that disk is erased by every deploy. This script is the one chance to rescue
 * the copies that still exist. Run it BEFORE the next deploy.
 *
 *   node scripts/backfill-referral-letters.js --dry-run   # report only
 *   node scripts/backfill-referral-letters.js             # write
 *
 * SAFE TO RE-RUN. It only imports letters that have no durable copy yet, so a
 * second run is a no-op over rows the first run handled. It never deletes a
 * file and never modifies referral_letters.
 *
 * WHAT IT CANNOT DO: recover a letter whose file is already gone. Those are
 * reported as MISSING and need regenerating, which is a separate decision --
 * a regenerated letter is dated today, not on the day it was issued, so this
 * script will not silently do it for you.
 */

const path = require('path');

// Explicit path, matching scripts/migrate.js: a bare config() resolves against
// the current working directory, so running this from anywhere but the repo
// root would silently load no credentials and fail against the wrong database.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const db = require('../db');
const { resolveLetterPath } = require('../services/pdfService');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
	console.log(DRY_RUN ? '[Backfill] DRY RUN -- no writes.\n' : '[Backfill] Writing durable letter copies.\n');

	// Every issued letter that has no durable copy yet. LEFT JOIN rather than
	// NOT IN so the query stays sargable and reports the pdf_path we need.
	const [rows] = await db.query(`
		SELECT rl.queue_id, rl.reference_number, rl.pdf_path
		FROM referral_letters rl
		LEFT JOIN referral_letter_files rlf ON rlf.queue_id = rl.queue_id
		WHERE rlf.id IS NULL
		ORDER BY rl.queue_id
	`);

	if (rows.length === 0) {
		console.log('[Backfill] Nothing to do -- every letter already has a durable copy.');
		return { imported: 0, missing: 0, noPath: 0 };
	}

	console.log(`[Backfill] ${rows.length} letter(s) without a durable copy.\n`);

	let imported = 0;
	let missing = 0;
	let noPath = 0;
	let bytes = 0;

	for (const row of rows) {
		const label = row.reference_number || `queue ${row.queue_id}`;

		if (!row.pdf_path) {
			console.warn(`  NO PATH   ${label} -- never had a file recorded.`);
			noPath++;
			continue;
		}

		let absolutePath;
		try {
			absolutePath = resolveLetterPath(row.pdf_path);
		} catch (error) {
			console.warn(`  BAD PATH  ${label} -- ${error.message}`);
			missing++;
			continue;
		}

		if (!fs.existsSync(absolutePath)) {
			console.warn(`  MISSING   ${label} -- file is gone from disk, needs regeneration.`);
			missing++;
			continue;
		}

		const buffer = fs.readFileSync(absolutePath);

		// A zero-byte or absurdly small file is a failed generation, not a letter.
		// Importing it would replace "file missing" with "file corrupt", which is
		// harder to notice.
		if (buffer.length < 1000) {
			console.warn(`  SUSPECT   ${label} -- only ${buffer.length} bytes, skipping as likely corrupt.`);
			missing++;
			continue;
		}

		if (DRY_RUN) {
			console.log(`  WOULD ADD ${label} (${(buffer.length / 1024).toFixed(1)} KB)`);
		} else {
			await db.query(`
				INSERT INTO referral_letter_files
					(queue_id, reference_number, content_base64, byte_size, source)
				VALUES (?, ?, ?, ?, 'backfilled')
				ON DUPLICATE KEY UPDATE
					content_base64 = VALUES(content_base64),
					byte_size = VALUES(byte_size),
					source = VALUES(source)
			`, [row.queue_id, row.reference_number, buffer.toString('base64'), buffer.length]);

			console.log(`  IMPORTED  ${label} (${(buffer.length / 1024).toFixed(1)} KB)`);
		}

		imported++;
		bytes += buffer.length;
	}

	console.log('\n────────────────────────────────────────');
	console.log(`  ${DRY_RUN ? 'Would import' : 'Imported'}: ${imported}  (${(bytes / 1024).toFixed(1)} KB total)`);
	if (missing > 0) console.log(`  Missing from disk: ${missing}  -- these need regenerating`);
	if (noPath > 0) console.log(`  No path recorded:  ${noPath}`);
	console.log('────────────────────────────────────────');

	if (missing > 0 || noPath > 0) {
		console.log('\nLetters listed as MISSING or NO PATH cannot be recovered by this script.');
		console.log('Their records are intact -- only the PDF is gone.');
	}

	return { imported, missing, noPath };
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('[Backfill] FAILED:', error.message);
		process.exit(1);
	});
