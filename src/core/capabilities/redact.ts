// One scrubber for every error message built from a dispatched call. An
// upstream may echo the credential it received in any of the encodings it
// was sent in: raw, after a scheme prefix, base64 (Basic), or URL-encoded
// (query placement). Each form is removed, and the result is length-capped.

export const MAX_ERROR_MESSAGE = 300;
const MASK = '[redacted]';

function base64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every spelling of the secret an upstream could plausibly echo. */
function secretForms(secret: string): string[] {
    const b64 = base64(secret);
    const forms = new Set<string>([
        secret,
        b64,
        b64.replace(/=+$/, ''),
        b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        encodeURIComponent(secret),
        new URLSearchParams({ k: secret }).toString().slice(2),
        encodeURIComponent(b64)
    ]);
    return [...forms].filter(form => form.length > 0).sort((a, b) => b.length - a.length);
}

export function redact(message: string, secret?: string): string {
    let text = message;
    if (secret) {
        for (const form of secretForms(secret)) {
            // Percent-encoding is case-insensitive in its hex digits.
            const flags = form.includes('%') ? 'gi' : 'g';
            text = text.replace(new RegExp(escapeRegExp(form), flags), MASK);
        }
    }
    return text.length > MAX_ERROR_MESSAGE ? `${text.slice(0, MAX_ERROR_MESSAGE)}…` : text;
}
