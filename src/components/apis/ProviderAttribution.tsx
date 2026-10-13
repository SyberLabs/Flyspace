'use client';

import type { Attribution } from '@/core/capabilities/curatedApis';

/**
 * What a provider's terms require an app to show (FRED's notice and terms
 * link), in the provider's own words. Not collapsible: the terms ask for it
 * to be shown prominently.
 */
export function ProviderAttribution({ attribution }: { attribution: Attribution }) {
    return (
        <p data-testid="provider-attribution" className="text-[10px] leading-snug text-[var(--text-secondary)]">
            {attribution.notice} Using this block means agreeing to the{' '}
            <a href={attribution.termsUrl} target="_blank" rel="noopener noreferrer" className="underline">
                {attribution.termsTitle}
            </a>.
        </p>
    );
}
