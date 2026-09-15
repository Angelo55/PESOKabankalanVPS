/**
 * Referral email content.
 *
 * Kept out of the worker so the wording can be changed without touching queue
 * logic -- and out of mailService so the transport stays generic.
 *
 * IMPORTANT: this email is written so that receiving it TWICE is not alarming.
 * The unavoidable crash window (SMTP accepted, DB commit failed) means a
 * duplicate is possible. It reads as a record of a referral, not as a one-time
 * event, so a second copy looks like a resend rather than a second referral.
 */

function buildReferralEmail(referral) {
	const subject = `PESO Referral Letter - ${referral.reference_number}`;

	// Administrator-initiated ("proactive") referrals get an extra line so the seeker
	// understands PESO reached out on their behalf — they never applied to this job.
	const isProactive = referral.origin === 'admin_referral';
	const proactiveText = 'Good news — based on your qualifications and our AI compatibility evaluation, PESO Kabankalan has PROACTIVELY referred you for this position. You did not need to apply.';

	const text = [
		`Dear ${referral.applicant_name},`,
		'',
		...(isProactive ? [proactiveText, ''] : []),
		`The Public Employment Service Office of Kabankalan City has endorsed you for the position of ${referral.job_title} at ${referral.company_name}.`,
		'',
		`Your referral letter is attached to this email.`,
		`Reference Number: ${referral.reference_number}`,
		'',
		'Please present this letter when you report to the employer. Keep the reference number for your records.',
		'',
		'You may also view this referral by logging in to the PESO Kabankalan platform.',
		'',
		'Public Employment Service Office',
		'City of Kabankalan, Negros Occidental'
	].join('\n');

	const html = `
		<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
			<div style="background: #1a4a38; padding: 24px; text-align: center;">
				<h1 style="color: #99e742; margin: 0; font-size: 18px; letter-spacing: 0.5px;">
					PUBLIC EMPLOYMENT SERVICE OFFICE
				</h1>
				<p style="color: #ffffff; margin: 6px 0 0; font-size: 13px;">
					City of Kabankalan, Negros Occidental
				</p>
			</div>

			<div style="padding: 32px 24px; background: #ffffff;">
				<p style="margin: 0 0 16px;">Dear <strong>${referral.applicant_name}</strong>,</p>

				${isProactive ? `<p style="margin: 0 0 16px; line-height: 1.6; background:#f0f5f3; border-left:4px solid #99e742; padding:12px 14px; border-radius:4px;">Good news — based on your qualifications and our <strong>AI compatibility evaluation</strong>, PESO Kabankalan has <strong>proactively referred you</strong> for this position. You did not need to apply.</p>` : ''}

				<p style="margin: 0 0 16px; line-height: 1.6;">
					The Public Employment Service Office of Kabankalan City has endorsed you for the position of
					<strong>${referral.job_title}</strong> at <strong>${referral.company_name}</strong>.
				</p>

				<div style="background: #f3f4f6; border-left: 4px solid #1a4a38; padding: 16px; margin: 24px 0;">
					<p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">
						Reference Number
					</p>
					<p style="margin: 4px 0 0; font-size: 18px; font-weight: bold; font-family: monospace; color: #1a4a38;">
						${referral.reference_number}
					</p>
				</div>

				<p style="margin: 0 0 16px; line-height: 1.6;">
					Your official referral letter is <strong>attached to this email</strong>. Please present it when you
					report to the employer, and keep the reference number for your records.
				</p>

				<p style="margin: 0 0 16px; line-height: 1.6;">
					You may also view this referral by logging in to the PESO Kabankalan platform.
				</p>
			</div>

			<div style="background: #f9fafb; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
				<p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.5;">
					This referral was issued electronically by the PESO Kabankalan employment platform.<br />
					Verify with reference number ${referral.reference_number}.
				</p>
			</div>
		</div>
	`;

	return { subject, text, html };
}

module.exports = { buildReferralEmail };