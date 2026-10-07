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
});
