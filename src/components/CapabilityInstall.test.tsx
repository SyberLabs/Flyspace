// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CapabilityInstall } from './CapabilityInstall';
import { clearCapabilities, listCapabilities } from '@/core/capabilities/registry';
import { MAX_SECRET_BYTES, capabilitySecrets } from '@/core/capabilities/secrets';
import { useCapabilityStore } from '@/core/capabilities/store';

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Sample Board', version: '1.0.0' },
    servers: [{ url: 'https://board.example.test/v1' }],
    components: {
        securitySchemes: {
            boardKey: { type: 'apiKey', in: 'header', name: 'X-Board-Key' }
        }
    },
    security: [{ boardKey: [] }],
    paths: {
        '/posts': {
            get: {
                operationId: 'listPosts',
                summary: 'List posts',
                responses: { '200': { description: 'posts' } }
            },
            post: {
                operationId: 'createPost',
                summary: 'Create post',
                responses: { '201': { description: 'created' } }
            }
        }
    }
};

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
});

afterEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
});

describe('CapabilityInstall', () => {
    it('rejects a document that is not JSON', () => {
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), { target: { value: '{not json' } });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
        expect(screen.getByText('OpenAPI document must be JSON')).toBeTruthy();
        expect(listCapabilities().some(manifest => manifest.source.operationId === 'listPosts')).toBe(false);
    });

    it('installs a compiled operation without writing the secret into the store', () => {
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), {
            target: { value: JSON.stringify(SPEC) }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
        expect(screen.getByLabelText('List posts')).toBeTruthy();
        expect(screen.getByLabelText('Create post')).toBeTruthy();

        const secret = screen.getByLabelText(/^Secret cred_/) as HTMLInputElement;
        fireEvent.change(secret, { target: { value: 'super-secret-value' } });
        fireEvent.click(screen.getByRole('button', { name: 'Install selected' }));

        const list = listCapabilities().find(manifest => manifest.source.operationId === 'listPosts');
        const create = listCapabilities().find(manifest => manifest.source.operationId === 'createPost');
        expect(list?.approval).toBe('auto');
        expect(create?.approval).toBe('pending');
        expect(capabilitySecrets.get(list!.auth.secretRef!)).toBe('super-secret-value');
        expect(JSON.stringify(useCapabilityStore.getState())).not.toContain('super-secret-value');
        expect(screen.getByRole('button', { name: 'Approve Create post' })).toBeTruthy();
        expect(screen.queryByText('Speak')).toBeNull();
    });

    it('refuses to install while a required secret slot is empty', () => {
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), {
            target: { value: JSON.stringify(SPEC) }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
        fireEvent.click(screen.getByRole('button', { name: 'Install selected' }));
        expect(screen.getByText(/Secret cred_.+ is required/)).toBeTruthy();
        expect(listCapabilities().some(manifest => manifest.source.operationId === 'listPosts')).toBe(false);
    });

    it('refuses to install a secret over the byte bound and writes nothing to the slot', () => {
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), {
            target: { value: JSON.stringify(SPEC) }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
        const secret = screen.getByLabelText(/^Secret cred_/) as HTMLInputElement;
        fireEvent.change(secret, { target: { value: 'k'.repeat(MAX_SECRET_BYTES + 1) } });
        fireEvent.click(screen.getByRole('button', { name: 'Install selected' }));
        expect(screen.getByText(new RegExp(`Secret cred_.+ exceeds ${MAX_SECRET_BYTES} bytes`))).toBeTruthy();
        expect(listCapabilities().some(manifest => manifest.source.operationId === 'listPosts')).toBe(false);
        const ref = (secret.getAttribute('aria-label') ?? '').replace(/^Secret /, '');
        expect(ref).toMatch(/^cred_/);
        expect(capabilitySecrets.get(ref)).toBeUndefined();
    });

    it('shows the origin and credential placement beside every proposal and secret field', () => {
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), {
            target: { value: JSON.stringify(SPEC) }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));

        for (const title of ['List posts', 'Create post']) {
            const row = screen.getByLabelText(title).closest('label')!;
            expect(row.textContent).toContain('https://board.example.test');
            expect(row.textContent).toContain('apiKey in header X-Board-Key');
        }
        const secret = screen.getByLabelText(/^Secret cred_/).closest('label')!;
        expect(secret.textContent).toContain('https://board.example.test');
        expect(secret.textContent).toContain('apiKey in header X-Board-Key');
        expect(secret.textContent).not.toContain('/v1');
        expect(screen.queryByText('Key travels in the URL')).toBeNull();
    });

    it('warns beside the secret field when the key will travel in the URL', () => {
        const querySpec = {
            ...SPEC,
            components: { securitySchemes: { boardKey: { type: 'apiKey', in: 'query', name: 'api_key' } } }
        };
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), {
            target: { value: JSON.stringify(querySpec) }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));

        const secret = screen.getByLabelText(/^Secret cred_/).closest('label')!;
        expect(secret.textContent).toContain('https://board.example.test');
        expect(secret.textContent).toContain('apiKey in query parameter api_key');
        expect(secret.textContent).toContain('Key travels in the URL');
        // Both proposal rows share the slot, so each row carries the warning too.
        expect(screen.getAllByText('Key travels in the URL')).toHaveLength(3);
    });

    it('shows the Authorization header for a bearer scheme, which carries no placement on the manifest', () => {
        const bearerSpec = {
            ...SPEC,
            components: { securitySchemes: { boardKey: { type: 'http', scheme: 'bearer' } } }
        };
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), {
            target: { value: JSON.stringify(bearerSpec) }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));

        const secret = screen.getByLabelText(/^Secret cred_/).closest('label')!;
        expect(secret.textContent).toContain('https://board.example.test');
        expect(secret.textContent).toContain('bearer in Authorization header');
        expect(screen.queryByText('Key travels in the URL')).toBeNull();
    });

    it('approves and removes through separate controls', () => {
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), {
            target: { value: JSON.stringify(SPEC) }
        });
        fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
        fireEvent.change(screen.getByLabelText(/^Secret cred_/), {
            target: { value: 'session-only' }
        });
        fireEvent.click(screen.getByLabelText('List posts'));
        fireEvent.click(screen.getByRole('button', { name: 'Install selected' }));

        expect(listCapabilities().some(manifest => manifest.source.operationId === 'listPosts')).toBe(false);
        expect(listCapabilities().find(manifest => manifest.source.operationId === 'createPost')?.approval).toBe('pending');

        fireEvent.click(screen.getByRole('button', { name: 'Approve Create post' }));
        expect(listCapabilities().find(manifest => manifest.source.operationId === 'createPost')?.approval).toBe('approved');
        expect(screen.queryByRole('button', { name: 'Approve Create post' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Remove Create post' }));
        expect(listCapabilities().some(manifest => manifest.source.operationId === 'createPost')).toBe(false);
    });

    it('names a persisted capability the current rule could not restore instead of hiding it', () => {
        useCapabilityStore.setState({
            stale: [{ id: 'cap_legacy', title: 'Search board', reason: 'MCP manifests now carry the server origin.', manifest: {} }]
        });
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        expect(screen.getByText(/needs re-install: MCP manifests now carry the server origin/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Forget Search board' }));
        expect(screen.queryByText(/needs re-install/)).toBeNull();
        expect(useCapabilityStore.getState().stale).toEqual([]);
    });
});
