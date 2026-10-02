// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CapabilityBlockView } from './CapabilityBlock';
import { compileOpenApi } from '@/core/capabilities/openapi';
import {
    approveCapability,
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
        expect(getBlockView('cap_anything_else')).toBe(CapabilityBlockView);

        const compiled = compileOpenApi(SPEC);
        const list = compiled.manifests.find(manifest => manifest.source.operationId === 'listPosts');
        expect(installProposal(list).ok).toBe(true);
        const fetchMock = vi.fn(async () => new Response(JSON.stringify([
            { id: 'p1', title: 'Hello from the board' }
        ]), { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(list!.id)!, { x: 0, y: 0 });
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));

        expect(await screen.findByText('Hello from the board')).toBeTruthy();
        expect(screen.getByText(/typed array/)).toBeTruthy();
    });

    it('does not run a write capability before approval', () => {
        const compiled = compileOpenApi(SPEC);
        const create = compiled.manifests.find(manifest => manifest.source.operationId === 'createPost');
        installProposal(create);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(create!.id)!, { x: 0, y: 0 });
        render(<CapabilityBlockView instanceId={instanceId} />);
        const button = screen.getByRole('button', { name: 'Needs approval' }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows the method, resolved URL and arguments of an approved write and sends it only after Send', async () => {
        const compiled = compileOpenApi(SPEC);
        const create = compiled.manifests.find(manifest => manifest.source.operationId === 'createPost')!;
        installProposal(create);
        approveCapability(create.id);
        const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(create.id)!, { x: 0, y: 0 });
        useBlockStore.getState().setParams(instanceId, { body: { title: 'Draft from a persona' } });
        render(<CapabilityBlockView instanceId={instanceId} />);

        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        const dialog = screen.getByRole('group', { name: 'Confirm request' });
        expect(within(dialog).getByTestId('confirm-method').textContent).toBe('POST');
        expect(within(dialog).getByTestId('confirm-url').textContent).toBe('https://board.example.test/v1/posts');
        expect(within(dialog).getByTestId('confirm-arguments').textContent).toContain('Draft from a persona');
        expect(fetchMock).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('https://board.example.test/v1/posts');
    });

    it('cancelling the confirmation sends nothing', () => {
        const compiled = compileOpenApi(SPEC);
        const create = compiled.manifests.find(manifest => manifest.source.operationId === 'createPost')!;
        installProposal(create);
        approveCapability(create.id);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(create.id)!, { x: 0, y: 0 });
        useBlockStore.getState().setParams(instanceId, { body: { title: 'Never sent' } });
        render(<CapabilityBlockView instanceId={instanceId} />);

        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('group', { name: 'Confirm request' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
