/**
 * Ad-hoc account/security notification emails.
 *
 * ── STATUS ──────────────────────────────────────────────────────────────────
 * This module currently has NO importers — authRoutes.js carries its own
 * `sendSecurityAlert`, and welcome emails are not wired anywhere. It is kept
 * (rather than deleted) so a future caller has a durable, provider-failover-safe
 * sender to reach for instead of newing up yet another private nodemailer
 * transport.
 *
 * ── PHASE 2C ────────────────────────────────────────────────────────────────
 * Rewired off its private Gmail transport onto the generic email outbox, so any
 * future caller inherits retry / backoff / dead-letter / admin-resend / delivery
 * monitoring for free. With EMAIL_OUTBOX_ENABLED off these send inline through
 * mailService (which has P0 provider failover); with it on they are queued and
 * drained by services/emailWorker.js. Both functions stay best-effort and never
 * throw (invariant 0.1) — a security-alert or welcome email must never fail the
 * action that triggered it.
 */

const emailOutboxService = require('./emailOutboxService');

// 1. Password Change / Security Alert
const sendSecurityAlert = async (email, req) => {
    try {
        if (!email) return;
        const ip = req?.ip || req?.headers?.['x-forwarded-for'] || 'Unknown IP';
        const userAgent = req?.headers?.['user-agent'] || 'Unknown Device';
        const timestamp = new Date().toUTCString();

        const html = `
            <div style="font-family: Arial; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
                <div style="background-color: #1a4a38; padding: 20px; text-align: center; color: white;">
                    <h2 style="margin: 0;">Security Alert</h2>
                </div>
                <div style="padding: 20px;">
                    <p>Hello,</p>
                    <p>The password for your Career Dashboard account was recently changed.</p>
                    <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <ul style="list-style-type: none; padding: 0; margin: 0;">
                            <li><strong>Time:</strong> ${timestamp}</li>
                            <li><strong>IP Address:</strong> ${ip}</li>
                            <li><strong>Device:</strong> ${userAgent}</li>
                        </ul>
                    </div>
                    <p style="color: #d9534f; font-weight: bold;">If you did NOT initiate this change, contact support immediately.</p>
                </div>
            </div>`;

        await emailOutboxService.enqueue({
            to: email,
            category: 'security_alert',
            subject: 'Security Alert: Your Password Was Changed',
            html,
        });
    } catch (error) {
        console.error("[EMAIL ERROR] Failed to queue security alert:", error.message);
    }
};

// 2. Automated Account Creation Notification
const sendWelcomeEmail = async (email, name, provider, req) => {
    try {
        if (!email) return;
        const timestamp = new Date().toUTCString();

        const html = `
            <div style="font-family: Arial; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
                <div style="background-color: #1a4a38; padding: 20px; text-align: center; color: white;">
                    <h2 style="margin: 0;">Welcome to Career Dashboard!</h2>
                </div>
                <div style="padding: 20px;">
                    <p>Hello ${name || 'User'},</p>
                    <p>This is a formal confirmation that your new account has been registered successfully.</p>
                    <div style="background-color: #f0f5f3; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin-top: 0; color: #1a4a38;">Registration Details:</h4>
                        <ul style="list-style-type: none; padding-left: 0; margin: 0;">
                            <li><strong>Auth Provider:</strong> ${provider}</li>
                            <li><strong>Timestamp:</strong> ${timestamp}</li>
                        </ul>
                    </div>
                </div>
            </div>`;

        await emailOutboxService.enqueue({
            to: email,
            category: 'welcome',
            subject: 'Welcome! Your account was created successfully',
            html,
        });
    } catch (error) {
        console.error("[EMAIL ERROR] Failed to queue welcome email:", error.message);
    }
};

module.exports = { sendSecurityAlert, sendWelcomeEmail };
