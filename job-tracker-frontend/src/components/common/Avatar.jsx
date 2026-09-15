import { useState } from 'react';
import { resolveAvatarSrc, generateAvatar, avatarSeedFor, isOrgAccount } from '../../utils/avatar';
import pesoLogo from '../../assets/PESO LOGO.jpg';

/**
 * The ONLY component that renders a user's face.
 *
 * Every module — top header, Profile & Identity, Messages Hub, Application
 * Tracking, notifications, chat — mounts this instead of its own `<img>` +
 * initials fallback. That is what makes an avatar change propagate everywhere
 * at once: there is one resolution rule (utils/avatar.js) and one renderer.
 *
 * It always renders an image. There is no initials state, no empty circle, and
 * no layout shift between "has a photo" and "does not" — a user without an
 * uploaded picture gets their deterministic DiceBear micah avatar instead.
 *
 * USAGE
 *   <Avatar user={user} size="md" />                  // header / list row
 *   <Avatar user={user} size={128} preferThumb={false} /> // profile hero
 *   <Avatar user={{ name, avatar_url }} />            // denormalised peer
 */

const SIZE_PRESETS = {
    xs: 'w-7 h-7',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
    '2xl': 'w-24 h-24'
};

const Avatar = ({
    user,
    size = 'md',
    // Passed as a prop rather than merged in via className: Tailwind resolves
    // `rounded-full rounded-xl` by stylesheet order, not by class order, so a
    // caller "overriding" the shape through className would silently lose.
    rounded = 'rounded-full',
    className = '',
    imgClassName = '',
    preferThumb = true,
    // 'org' forces the PESO organisation logo regardless of any stored avatar —
    // an explicit escape hatch for surfaces that render the org account without a
    // role on the user object. Otherwise the org is auto-detected from the role.
    variant,
    alt,
    ...rest
}) => {
    const org = variant === 'org' || isOrgAccount(user);
    const resolved = resolveAvatarSrc(user, { preferThumb });

    // A stored avatar can 404 or be a corrupt data URI. Rather than showing the
    // browser's broken-image glyph, fall through to the generated avatar — the
    // same face the user would have had with no upload at all.
    //
    // We remember WHICH src failed rather than holding the displayed src in
    // state. That derives the fallback during render (no setState-in-effect,
    // no cascading render) and self-resets for free: the moment the user picks
    // a new avatar, `resolved` changes, stops matching `failedSrc`, and the new
    // image is attempted.
    const [failedSrc, setFailedSrc] = useState(null);
    const src = failedSrc === resolved ? generateAvatar(avatarSeedFor(user)) : resolved;

    // Numeric sizes are for the few places that need an exact pixel box (the
    // profile hero); named presets cover everything else and stay on the
    // Tailwind scale the rest of the UI uses.
    const isNumeric = typeof size === 'number';
    const sizeClass = isNumeric ? '' : (SIZE_PRESETS[size] || SIZE_PRESETS.md);
    const style = isNumeric ? { width: size, height: size } : undefined;

    // The organisation account shows the official PESO logo. A logo is not a face,
    // so it is `object-contain` on a white ground (never cropped like a photo).
    if (org) {
        return (
            <span
                className={`inline-block shrink-0 overflow-hidden bg-white ${rounded} ${sizeClass} ${className}`}
                style={style}
                {...rest}
            >
                <img
                    src={pesoLogo}
                    alt={alt || 'PESO Kabankalan'}
                    loading="lazy"
                    draggable={false}
                    className={`w-full h-full object-contain p-0.5 ${imgClassName}`}
                />
            </span>
        );
    }

    return (
        <span
            className={`inline-block shrink-0 overflow-hidden bg-sunken ${rounded} ${sizeClass} ${className}`}
            style={style}
            {...rest}
        >
            <img
                src={src}
                alt={alt || user?.name || 'Profile photo'}
                loading="lazy"
                draggable={false}
                // Only the STORED src can fail this way; once we have swapped to
                // the generated avatar, `failedSrc === resolved` already holds,
                // so re-firing cannot loop.
                onError={() => setFailedSrc(resolved)}
                className={`w-full h-full object-cover ${imgClassName}`}
            />
        </span>
    );
};

export default Avatar;
