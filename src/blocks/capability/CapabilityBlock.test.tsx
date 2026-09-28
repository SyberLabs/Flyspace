// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapabilityBlockView } from './CapabilityBlock';
import { compileOpenApi } from '@/core/capabilities/openapi';
import {
    clearCapabilities,
    installProposal
} from '@/core/capabilities/registry';
import { capabilitySecrets } from '@/core/capabilities/secrets';
import { getBlockView } from '@/core/registry/ViewRegistry';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore } from '@/core/stores';

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Sample Board', version: '1.0.0' },
    servers: [{ url: 'https://board.example.test/v1' }],
    paths: {
        '/posts': {
            get: {
                operationId: 'listPosts',
                summary: 'List posts',
                responses: {
                    '200': {
                        description: 'posts',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        required: ['id', 'title'],
                                        properties: {
                                            id: { type: 'string' },
                                            title: { type: 'string' }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            post: {
                operationId: 'createPost',
                summary: 'Create post',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['title'],
                                properties: { title: { type: 'string' } }
                            }
                        }
                    }
                },
                responses: { '201': { description: 'created' } }
            }
        }
    }
};

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
});

afterEach(() => {
    clearCapabilities();
    vi.unstubAllGlobals();
});

describe('CapabilityBlockView', () => {
    it('resolves every cap_ block to the shared view and renders a read result', async () => {
        expect(getBlockView('polymarket_live_odds')).toBeTypeOf('function');
        expect(getBlockView('cap_listposts')).toBe(CapabilityBlockView);

        const compiled = compileOpenApi(SPEC);
        const list = compiled.manifests.find(manifest => manifest.id === 'cap_listposts');
        expect(installProposal(list).ok).toBe(true);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
            { id: 'p1', title: 'Hello from the board' }
        ]), { status: 200, headers: { 'content-type': 'application/json' } })));

        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get('cap_listposts')!, { x: 0, y: 0 });
        render(<CapabilityBlockView instanceId={instanceId} />);

        expect(await screen.findByText('Hello from the board')).toBeTruthy();
        expect(screen.getByText(/typed array/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    });

    it('does not run a write capability before approval', () => {
        const compiled = compileOpenApi(SPEC);
        const create = compiled.manifests.find(manifest => manifest.id === 'cap_createpost');
        installProposal(create);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get('cap_createpost')!, { x: 0, y: 0 });
        render(<CapabilityBlockView instanceId={instanceId} />);
        const button = screen.getByRole('button', { name: 'Needs approval' }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
