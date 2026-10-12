// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CapabilityBlockView } from './CapabilityBlock';
import { setConnectProvidersForTests } from '@/core/capabilities/connect';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { clearCapabilities, installProposal } from '@/core/capabilities/registry';
import { capabilitySecrets } from '@/core/capabilities/secrets';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore, useWireStore } from '@/core/stores';

const READ = 'https://www.googleapis.com/auth/calendar.readonly';

function placeColors(): { manifest: CapabilityManifest; instanceId: string } {
    const [manifest] = compileOpenApi({
        openapi: '3.0.0',
        info: { title: 'Calendar', version: 'v3' },
        servers: [{ url: 'https://www.googleapis.com/calendar/v3' }],
        components: { securitySchemes: { Oauth2c: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: 'https://accounts.google.com/o/oauth2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes: { [READ]: 'read' } } } } } },
        paths: { '/colors': { get: { operationId: 'calendar.colors.get', summary: 'Calendar colors', security: [{ Oauth2c: [READ] }], responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { kind: { type: 'string' } } } } } } } } } }
    }).manifests;
    expect(installProposal(manifest).ok).toBe(true);
    const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(manifest.id)!, { x: 0, y: 0 });
    return { manifest, instanceId };
}

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    setConnectProvidersForTests([]);
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    vi.unstubAllGlobals();
    setConnectProvidersForTests([]);
    clearCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [] });
});

describe('a block that needs a sign-in', () => {
    it('says the server has no sign-in set up, and does not run', () => {
        const { instanceId } = placeColors();
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect(screen.getByText('This API needs you to sign in to Google.')).toBeTruthy();
        expect(screen.getByText(/Google sign-in is not set up on this server/)).toBeTruthy();
        expect(screen.getByText(/Read-only access: calendar\.readonly/)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Sign in first' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('opens the sign-in window from the click when the server has a Google client', () => {
        const { instanceId } = placeColors();
        setConnectProvidersForTests(['google']);
        const open = vi.fn(() => ({}));
        vi.stubGlobal('open', open);
        render(<CapabilityBlockView instanceId={instanceId} />);
        fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
        expect(open).toHaveBeenCalledTimes(1);
        expect(String((open.mock.calls[0] as unknown[])[0])).toMatch(/^\/api\/oauth\/google\/start\?nonce=[0-9a-f]{48}&scope=/);
        expect(screen.getByText('Waiting for the sign-in window…')).toBeTruthy();
    });

    it('runs once the session holds a token for its slot', () => {
        const { manifest, instanceId } = placeColors();
        render(<CapabilityBlockView instanceId={instanceId} />);
        act(() => capabilitySecrets.set(manifest.auth.secretRef!, 'ya29.token'));
        expect(screen.queryByText('This API needs you to sign in to Google.')).toBeNull();
        expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(false);
    });
});
