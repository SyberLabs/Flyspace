import { describe, expect, it, beforeEach } from 'vitest';
import {
    approveCapability,
    denyCapability,
    executeCapability,
    installProposal,
    listManifests,
    resetCapabilities,
    setCapabilitySecret
} from './manifest';

describe('capability manifests', () => {
    beforeEach(() => resetCapabilities());

    it('approves a read at install and keeps a write pending', () => {
        const read = installProposal({
            name: 'List markets',
            origin: 'polymarket',
            operation: 'list',
            effect: 'read',
            outputs: [{ name: 'markets', dataType: 'json' }]
        });
        const write = installProposal({
            name: 'Place order',
            origin: 'polymarket',
            operation: 'order',
            effect: 'write',
            inputs: [{ name: 'size', dataType: 'json', required: true }]
        });
        expect(read.status).toBe('approved');
        expect(write.status).toBe('proposed');
        expect(() => executeCapability(write.id, { size: 1 }, () => ({ ok: true }))).toThrow(/approval/);
        approveCapability(write.id);
        expect(executeCapability(write.id, { size: 1 }, () => ({ ok: true })).output).toEqual({ ok: true });
    });

    it('keeps secrets out of the manifest and out of the output', () => {
        const manifest = installProposal({
            name: 'Keyed read',
            origin: 'news',
            operation: 'headlines',
            effect: 'read'
        });
        setCapabilitySecret(manifest.id, 'super-secret-token');
        expect(JSON.stringify(listManifests())).not.toContain('super-secret-token');
        expect(() => executeCapability(manifest.id, {}, (_input, secret) => ({ echo: secret }))).toThrow(/leaked/);
        denyCapability(manifest.id);
        expect(() => executeCapability(manifest.id, {}, () => ({}))).toThrow(/denied/);
    });
});
