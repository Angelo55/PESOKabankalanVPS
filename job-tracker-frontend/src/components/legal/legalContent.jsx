/**
 * legalContent — the SINGLE source of truth for the PESO Kabankalan legal documents
 * (Privacy Policy, Terms of Service, Cookie Policy).
 *
 * WHY THIS EXISTS: the Privacy + Terms text previously lived inline inside the Landing
 * modals only. It now backs BOTH the in-page modals (LandingPage.jsx, shown during the
 * signup-consent flow so a user never navigates away mid-signup) AND the standalone routed
 * pages (`/privacy`, `/terms`, `/cookies` — shareable, indexable URLs). Keeping ONE copy
 * here means the two surfaces can never drift (SKILL §56 — the modals must stay truthful to
 * the system: no government-ID collection §48, real subprocessors disclosed).
 *
 * Each doc is `{ slug, title, updated, sections: [{ heading, body }] }`. `body` is JSX so a
 * section can carry links. Render a doc's sections with <LegalSections> below; the standalone
 * page and the modal both wrap it in their own shell, so the sections look identical in both.
 */
import React from 'react';

// Bump when the wording changes — surfaced as "Last updated" on the standalone pages.
export const LEGAL_UPDATED = 'September 2026';

export const PRIVACY = {
    slug: 'privacy',
    title: 'Privacy Policy',
    updated: LEGAL_UPDATED,
    sections: [
        {
            heading: '1. Information Collected',
            body: <p>The PESO Kabankalan Employment System collects personally identifiable information (PII) including but not limited to your full name, email address, contact number, educational background, employment history, and the résumé/CV you provide, strictly for the purposes of job matching and employment facilitation. The system does not collect or store scanned government identification documents.</p>,
        },
        {
            heading: '2. Data Processing and AI Integration',
            body: <p>Résumés and profile data uploaded to the system may be processed by integrated third-party artificial-intelligence services — the DeepSeek language model, accessed directly and through the OpenRouter gateway — to generate compatibility scores, skills-gap analysis, and document drafts, and by the DeepL service for multilingual replies. These providers may process data on servers outside the Philippines; only the minimum text necessary for the requested result is transmitted, and it is not used to train their models. Supporting processors include Cloudflare R2 (image storage), our transactional email provider, and Google (only if you choose "Sign in with Google"). By using these features you consent to this processing. You can use the platform without the AI features if you prefer.</p>,
        },
        {
            heading: '3. Data Security and Retention',
            body: <p>Your data is securely stored and transmitted over encrypted connections. The platform uses a single strictly-necessary session cookie, together with your browser's local storage, only to keep you signed in and remember interface preferences (such as light/dark mode); it sets no advertising, analytics, or third-party tracking cookies. The platform retains your profile information for as long as your account remains active or as required by Philippine data-retention rules for government employment services.</p>,
        },
        {
            heading: '4. User Rights',
            body: <p>Under the Data Privacy Act of 2012 (Republic Act No. 10173), you have the right to request access to, correction of, or deletion of your personal data stored within our system. Such requests can be initiated through your account settings or by contacting the PESO Kabankalan administrative office directly.</p>,
        },
    ],
};

export const TERMS = {
    slug: 'terms',
    title: 'Terms of Service',
    updated: LEGAL_UPDATED,
    sections: [
        {
            heading: '1. Acceptance of Terms',
            body: <p>By accessing and registering on the PESO Kabankalan Employment System, you agree to comply with and be bound by these Terms of Service. This platform is managed by the Public Employment Service Office (PESO) of Kabankalan City in compliance with the Department of Labor and Employment (DOLE) guidelines under Republic Act No. 8759 and Republic Act No. 10691.</p>,
        },
        {
            heading: '2. User Responsibilities',
            body: <p>Job seekers agree to provide accurate, current, and complete information during registration and profile creation. Users are solely responsible for safeguarding their account credentials and are strictly prohibited from sharing access to third parties or attempting to bypass platform security measures.</p>,
        },
        {
            heading: '3. Acceptable Use',
            body: <p>The platform must be used strictly for legitimate employment facilitation, job matching, and career development purposes. Any form of harassment, distribution of malicious software, data scraping, or fraudulent representation of credentials will result in immediate account termination and potential legal action.</p>,
        },
        {
            heading: '4. Limitation of Liability',
            body: <p>The PESO Kabankalan Employment System facilitates connections between job seekers and employers but does not guarantee employment. The Local Government Unit (LGU) and PESO are not liable for any disputes, damages, or losses arising from interactions, negotiations, or contracts formed outside the platform.</p>,
        },
        {
            heading: '5. Account Suspension',
            body: <p>Administrators reserve the right to suspend, disable, or permanently ban accounts found to violate these Terms of Service, engage in fraudulent activity, or fail to pass verification protocols without prior notice.</p>,
        },
    ],
};

export const COOKIES = {
    slug: 'cookies',
    title: 'Cookie Policy',
    updated: LEGAL_UPDATED,
    sections: [
        {
            heading: '1. What we use',
            body: <p>The PESO Kabankalan Employment System uses only what it needs to function. It sets a single, strictly-necessary session cookie to keep you securely signed in; that cookie is HTTP-only (not readable by scripts), restricted to this site, and expires automatically. The platform also uses your browser's local and session storage to remember interface preferences (such as light or dark mode) and your recent searches. No advertising, analytics, or third-party tracking cookies are set, and you are not tracked across other websites.</p>,
        },
        {
            heading: '2. Why there is no consent banner',
            body: <p>Because the platform uses only strictly-necessary cookies and does not profile or track you across other sites, a cookie-consent banner is not required under the Data Privacy Act of 2012 (Republic Act No. 10173). This notice, together with our Privacy Policy, is how we keep you informed of that use.</p>,
        },
        {
            heading: '3. Managing cookies and storage',
            body: <p>You can clear or block cookies and site storage at any time through your browser settings, and signing out clears your session. Note that disabling the strictly-necessary session cookie will prevent you from staying signed in.</p>,
        },
        {
            heading: '4. Questions',
            body: <p>For any question about how the platform uses cookies or your personal data, contact the PESO Kabankalan office using the details on our home page, or review our Privacy Policy.</p>,
        },
    ],
};

export const LEGAL_DOCS = { privacy: PRIVACY, terms: TERMS, cookies: COOKIES };

/**
 * Renders a doc's sections with the shared heading/body styling. Used verbatim by the Landing
 * modals AND the standalone pages, so both read identically. The wrapper (scroll container,
 * body text color, spacing) belongs to the caller.
 */
export const LegalSections = ({ sections }) => (
    <>
        {sections.map((s, i) => (
            <section key={i}>
                <h3 className="text-base font-bold text-[#003631] dark:text-[#7fd8ba] mb-2">{s.heading}</h3>
                {s.body}
            </section>
        ))}
    </>
);
