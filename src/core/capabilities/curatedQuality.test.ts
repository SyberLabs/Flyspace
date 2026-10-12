import { describe, expect, it } from 'vitest';
import { verificationFrom, verificationOf } from './curatedQuality';
import { CURATED_APIS } from './curatedApis';

const report = (results: { api: string; status: string; detail: string }[]) => ({
    format: 'flyspace-curated-quality', version: 1, checkedAt: '2026-10-12T21:00:00.000Z', results
});

describe('what the quality line says about a curated API', () => {
    it('is verified with a live answer and no failure', () => {
        expect(verificationFrom(report([{ api: 'a', status: 'ok', detail: '' }, { api: 'a', status: 'skipped', detail: '' }]), 'a'))
            .toEqual({ status: 'verified', checkedAt: '2026-10-12T21:00:00.000Z' });
    });

    it('is failing when any operation failed, with why', () => {
        expect(verificationFrom(report([{ api: 'a', status: 'ok', detail: '' }, { api: 'a', status: 'failed', detail: 'HTTP 404' }]), 'a'))
            .toMatchObject({ status: 'failing', detail: 'HTTP 404' });
    });

    it('is unverified when every operation needed a key the run did not have', () => {
        expect(verificationFrom(report([{ api: 'a', status: 'skipped', detail: 'no key' }]), 'a'))
            .toMatchObject({ status: 'unverified', reason: 'needs a key to check' });
    });

    it('is unverified, not verified, for a malformed or missing report', () => {
        expect(verificationFrom({ results: [{ api: 'a', status: 'ok', detail: '' }] }, 'a')).toMatchObject({ status: 'unverified' });
        expect(verificationFrom(null, 'a')).toMatchObject({ status: 'unverified', reason: 'not checked yet' });
        expect(verificationFrom(report([]), 'a')).toMatchObject({ status: 'unverified', reason: 'not checked yet' });
    });

    it('has an answer for every curated API in the committed report', () => {
        for (const api of CURATED_APIS) expect(['verified', 'failing', 'unverified']).toContain(verificationOf(api.entry.id).status);
        expect(verificationOf('omni:bls').status).toBe('verified');
    });
});
