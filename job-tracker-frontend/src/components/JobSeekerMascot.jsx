import React, { useId } from 'react';

/**
 * JobSeekerMascot — the PESO Kabankalan mascot, as a reusable, self-contained SVG.
 *
 * Replaces the previous "Gebbie" bunny with a visual that represents the
 * platform's actual purpose: a friendly person actively seeking employment —
 * holding a résumé, ready to be matched to a local job.
 *
 * This is a STATIC render (no dependency on the landing page's animation
 * keyframes), so it is safe to drop in anywhere (chat launcher, chat header,
 * message avatars). Gradient IDs are made unique per instance with useId(), so
 * several copies can render on the same page without clashing <defs> ids.
 *
 * @param avatar    when true, crops the viewBox to the head/shoulders for use
 *                  inside a small circular frame (launcher / header / bubbles).
 * @param className sizing / layout classes for the <svg>.
 */
const JobSeekerMascot = ({ avatar = false, className = '', title = 'Your friendly PESO employment assistant' }) => {
    const uid = useId().replace(/:/g, '');
    const skin = `js-skin-${uid}`;
    const shirt = `js-shirt-${uid}`;
    const hairG = `js-hair-${uid}`;

    // Full figure vs. a tighter crop around the head/shoulders for avatar contexts.
    const viewBox = avatar ? '80 38 120 122' : '0 0 280 340';

    return (
        <svg viewBox={viewBox} width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={title} className={`overflow-visible ${className}`}>
            <defs>
                <linearGradient id={skin} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f6cda6" />
                    <stop offset="100%" stopColor="#e7ac82" />
                </linearGradient>
                <linearGradient id={shirt} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4F7942" />
                    <stop offset="100%" stopColor="#3E6234" />
                </linearGradient>
                <linearGradient id={hairG} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3a2b20" />
                    <stop offset="100%" stopColor="#2a1f17" />
                </linearGradient>
            </defs>

            {!avatar && <ellipse cx="140" cy="324" rx="66" ry="11" fill="#334155" opacity="0.16" />}

            {!avatar && (
                <>
                    {/* legs + shoes — only in the full figure */}
                    <rect x="118" y="252" width="20" height="62" rx="10" fill="#33415e" />
                    <rect x="142" y="252" width="20" height="62" rx="10" fill="#3b4a68" />
                    <ellipse cx="122" cy="316" rx="17" ry="9" fill="#1f2937" />
                    <ellipse cx="158" cy="316" rx="17" ry="9" fill="#1f2937" />
                </>
            )}

            {!avatar && (
                <>
                    {/* torso / collared shirt */}
                    <path d="M96 168 C 96 150 116 142 140 142 C 164 142 184 150 184 168 L 190 258 C 190 268 182 274 172 274 L 108 274 C 98 274 90 268 90 258 Z" fill={`url(#${shirt})`} />
                    {/* open collar */}
                    <path d="M128 146 L 140 164 L 152 146 Z" fill="#ffffff" opacity="0.92" />
                    <path d="M128 146 L 122 160 M152 146 L 158 160" stroke="#3E6234" strokeWidth="3" strokeLinecap="round" />

                    {/* PESO lanyard + ID badge — the single brand accent */}
                    <path d="M132 150 L 140 196 L 148 150" fill="none" stroke="#99e742" strokeWidth="5" strokeLinejoin="round" />
                    <rect x="126" y="192" width="28" height="34" rx="5" fill="#f8fafc" stroke="#1a4a38" strokeWidth="2" />
                    <circle cx="140" cy="203" r="6" fill="#99e742" />
                    <rect x="131" y="212" width="18" height="3" rx="1.5" fill="#94a3b8" />
                    <rect x="133" y="218" width="14" height="3" rx="1.5" fill="#cbd5e1" />

                    {/* résumé held in the near hand (screen-right) */}
                    <g transform="rotate(7 214 214)">
                        <rect x="186" y="168" width="66" height="90" rx="6" fill="#ffffff" stroke="#d7dde5" strokeWidth="2" />
                        <rect x="186" y="168" width="66" height="16" rx="6" fill="#4F7942" />
                        <rect x="195" y="194" width="20" height="20" rx="3" fill="#e2e8f0" />
                        <rect x="221" y="196" width="24" height="4" rx="2" fill="#cbd5e1" />
                        <rect x="221" y="205" width="20" height="4" rx="2" fill="#dbe2ea" />
                        <rect x="195" y="224" width="48" height="4" rx="2" fill="#dbe2ea" />
                        <rect x="195" y="233" width="48" height="4" rx="2" fill="#dbe2ea" />
                        <rect x="195" y="242" width="34" height="4" rx="2" fill="#dbe2ea" />
                    </g>
                    {/* near hand gripping the résumé edge */}
                    <path d="M170 214 Q 184 206 196 214" fill="none" stroke={`url(#${shirt})`} strokeWidth="22" strokeLinecap="round" />
                    <circle cx="198" cy="214" r="12" fill={`url(#${skin})`} />
                </>
            )}

            {/* neck */}
            <rect x="130" y="120" width="20" height="30" rx="9" fill={`url(#${skin})`} />

            {/* head */}
            <circle cx="140" cy="92" r="46" fill={`url(#${skin})`} />
            {/* ears */}
            <circle cx="95" cy="96" r="9" fill={`url(#${skin})`} />
            <circle cx="185" cy="96" r="9" fill={`url(#${skin})`} />
            {/* hair — short, gender-neutral crown */}
            <path d="M96 92 C 92 52 118 40 140 40 C 162 40 188 52 184 92 C 176 74 168 68 158 66 C 150 78 130 78 122 66 C 112 68 104 74 96 92 Z" fill={`url(#${hairG})`} />

            {/* eyes */}
            <ellipse cx="122" cy="92" rx="6.5" ry="8" fill="#ffffff" />
            <ellipse cx="158" cy="92" rx="6.5" ry="8" fill="#ffffff" />
            <circle cx="123.5" cy="94" r="4" fill="#3d2814" />
            <circle cx="159.5" cy="94" r="4" fill="#3d2814" />
            <circle cx="125" cy="92" r="1.4" fill="#ffffff" />
            <circle cx="161" cy="92" r="1.4" fill="#ffffff" />
            {/* brows */}
            <path d="M113 80 Q 122 76 131 80" stroke="#4a3728" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
            <path d="M149 80 Q 158 76 167 80" stroke="#4a3728" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
            {/* cheeks */}
            <ellipse cx="112" cy="108" rx="8" ry="5" fill="#f6a48a" opacity="0.55" />
            <ellipse cx="168" cy="108" rx="8" ry="5" fill="#f6a48a" opacity="0.55" />
            {/* nose + friendly smile */}
            <path d="M138 100 Q 140 104 142 100" fill="none" stroke="#c98a63" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M126 112 Q 140 124 154 112" fill="none" stroke="#4a2f1b" strokeWidth="4" strokeLinecap="round" />

            {!avatar && (
                <>
                    {/* waving arm (screen-left) — the greeting hand */}
                    <path d="M96 170 Q 70 150 66 118" fill="none" stroke={`url(#${shirt})`} strokeWidth="22" strokeLinecap="round" />
                    <circle cx="65" cy="112" r="13" fill={`url(#${skin})`} />
                    <path d="M58 106 Q 62 102 66 101 M70 102 Q 73 104 74 108" stroke="#c98a63" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                </>
            )}
        </svg>
    );
};

export default JobSeekerMascot;
