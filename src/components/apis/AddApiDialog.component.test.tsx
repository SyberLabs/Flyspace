// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { AddApiDialog } from './AddApiDialog';
import type { ApiIndex, ApiIndexEntry } from '@/core/capabilities/apiIndex';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { clearCapabilities, installProposal, listCapabilities } from '@/core/capabilities/registry';
import { MAX_SECRET_BYTES, capabilitySecrets } from '@/core/capabilities/secrets';
import { useCapabilityStore } from '@/core/capabilities/store';
import { useBlockStore } from '@/core/stores/blockStore';

// ============================================
// Fixtures
// ============================================

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Sample Board', version: '1.0.0' },
    servers: [{ url: 'https://board.example.test/v1' }],
    components: { securitySchemes: { boardKey: { type: 'apiKey', in: 'header', name: 'X-Board-Key' } } },
    security: [{ boardKey: [] }],
    paths: {
        '/posts': {
            get: { operationId: 'listPosts', summary: 'List posts', responses: { '200': { description: 'posts' } } },
            post: { operationId: 'createPost', summary: 'Create post', responses: { '201': { description: 'created' } } }
        }
    }
};

const KEYLESS_SPEC = {
    openapi: '3.0.0',
    info: { title: 'Weather', version: '1' },
    servers: [{ url: 'https://weather.visualcrossing.com' }],
    paths: {
        '/timeline/{location}': { get: { summary: 'Forecast timeline', parameters: [{ name: 'location', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
        '/history': { get: { summary: 'Weather history', responses: { '200': { description: 'ok' } } } }
    }
};

function entry(id: string, title: string, extra: Partial<ApiIndexEntry> = {}): ApiIndexEntry {
    return {
        id, title, description: '', categories: [],
        specUrl: `https://api.apis.guru/v2/specs/${id.replace(':', '/')}/1.0.0/openapi.json`,
        openapiVersion: '3.0.0', supported: true, updated: '2023-03-06', ...extra
    };
}

const INDEX: ApiIndex = {
    format: 'omni-api-index',
    version: 1,
    source: { url: 'https://api.apis.guru/v2/list.json', license: 'CC0-1.0', etag: null, lastModified: 'Mon, 18 Aug 2025 10:53:40 GMT' },
    builtAt: '2026-10-07T00:00:00.000Z',
    entries: [
        entry('visualcrossing.com:weather', 'Visual Crossing Weather API', { description: 'Weather forecast' }),
        entry('stormglass.io', 'Storm Glass Marine Weather', { openapiVersion: '2.0', supported: false })
    ]
};

let fetched: string[] = [];
const calls = () => fetched;

function serve(spec: unknown = KEYLESS_SPEC) {
    fetched = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (url === '/api-index.json') return new Response(JSON.stringify(INDEX));
        if (url.startsWith('https://api.apis.guru/')) return new Response(JSON.stringify(spec));
        return new Response('not found', { status: 404 });
    }));
}

/** The dialog as the sidebar mounts it: open until it asks to close. */
function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <AddApiDialog open onClose={() => setOpen(false)} /> : <p>closed</p>;
}

function paste(spec: unknown) {
    fireEvent.click(screen.getByRole('button', { name: 'Have a spec already? Paste OpenAPI' }));
    fireEvent.change(screen.getByLabelText('OpenAPI document'), { target: { value: JSON.stringify(spec) } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
}

const placedCapabilityBlocks = () => useBlockStore.getState().blocks.filter(block => block.schema.capabilityId);

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [] });
    serve();
});

afterEach(() => {
    vi.unstubAllGlobals();
    clearCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [] });
});

// ============================================
// Find → review → install & place
// ============================================

describe('AddApiDialog: a curated API (FRED)', () => {
    it('finds FRED beside the directory, says its calls go through OmniOS, and installs it as broker reads', async () => {
        render(<Harness />);
        fireEvent.change(await screen.findByLabelText('Search APIs'), { target: { value: 'unemployment inflation' } });
        expect(screen.getByText('· curated by OmniOS')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Review FRED Economic Data' }));

        expect(await screen.findByText(/Spec written by OmniOS from the provider/)).toBeTruthy();
        expect(screen.getByText(/Sends requests to/).textContent).toContain('https://api.stlouisfed.org through OmniOS’s own server');
        expect(screen.getByText(/refuses calls from a browser/)).toBeTruthy();
        const key = screen.getByLabelText('Key for https://api.stlouisfed.org').closest('label')!;
        expect(key.textContent).toContain('Request one at https://fredaccount.stlouisfed.org/apikeys');

        fireEvent.change(screen.getByLabelText('Key for https://api.stlouisfed.org'), { target: { value: 'abc123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Install & place' }));

        const installed = listCapabilities().filter(m => m.source.locator === 'omni:curated/fred');
        expect(installed).toHaveLength(3);
        for (const manifest of installed) expect(manifest.transport.kind === 'http' && manifest.transport.access).toBe('server_broker');
        expect(placedCapabilityBlocks()[0].schema.display_name).toBe('Values of an economic series over time');
        expect(calls().some(url => url.includes('stlouisfed'))).toBe(false); // nothing fetched for the spec
    });
});

describe('AddApiDialog: from search to the canvas', () => {
    it('opens on search, and reviews nothing until an API is chosen', async () => {
        render(<Harness />);
        expect(screen.getByRole('dialog', { name: 'Add an API' })).toBeTruthy();
        expect(await screen.findByLabelText('Search APIs')).toBeTruthy();
        expect(screen.getByText('Choose an API to see what it does.')).toBeTruthy();
    });

    it('lists an unsupported API but does not let you choose it', async () => {
        render(<Harness />);
        fireEvent.change(await screen.findByLabelText('Search APIs'), { target: { value: 'weather' } });
        const unsupported = screen.getByRole('button', { name: 'Storm Glass Marine Weather (not supported)' }) as HTMLButtonElement;
        expect(unsupported.disabled).toBe(true);
    });

    it('installs and places the first read operation on the canvas, then closes', async () => {
        render(<Harness />);
        fireEvent.change(await screen.findByLabelText('Search APIs'), { target: { value: 'weather' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Visual Crossing Weather API' }));

        expect(await screen.findByLabelText('Install Forecast timeline')).toBeTruthy();
        expect(screen.getByText(/Sends requests to/).textContent).toContain('https://weather.visualcrossing.com');
        expect(screen.getByText(/Spec updated 2023-03-06/)).toBeTruthy();
        expect((screen.getByLabelText('Place Forecast timeline on the canvas') as HTMLInputElement).checked).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Install & place' }));

        expect(listCapabilities().filter(m => m.source.locator === INDEX.entries[0].specUrl)).toHaveLength(2);
        const placed = placedCapabilityBlocks();
        expect(placed).toHaveLength(1);
        expect(placed[0].schema.display_name).toBe('Forecast timeline');
        expect(screen.getByText('closed')).toBeTruthy();
    });

    it('places the operation you mark instead', async () => {
        render(<Harness />);
        fireEvent.change(await screen.findByLabelText('Search APIs'), { target: { value: 'weather' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Visual Crossing Weather API' }));
        fireEvent.click(await screen.findByLabelText('Place Weather history on the canvas'));
        fireEvent.click(screen.getByRole('button', { name: 'Install & place' }));
        expect(placedCapabilityBlocks().map(b => b.schema.display_name)).toEqual(['Weather history']);
    });

    it('installs without placing when the marked operation is unselected', async () => {
        render(<Harness />);
        fireEvent.change(await screen.findByLabelText('Search APIs'), { target: { value: 'weather' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Visual Crossing Weather API' }));
        fireEvent.click(await screen.findByLabelText('Install Forecast timeline'));
        expect(screen.getByText('Installs 1. Nothing is placed on the canvas.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Install' }));
        expect(listCapabilities().map(m => m.title)).toEqual(['Weather history']);
        expect(placedCapabilityBlocks()).toHaveLength(0);
    });

    it('says so when the spec cannot be fetched', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
            String(input) === '/api-index.json' ? new Response(JSON.stringify(INDEX)) : new Response('gone', { status: 404 })));
        render(<Harness />);
        fireEvent.change(await screen.findByLabelText('Search APIs'), { target: { value: 'weather' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Visual Crossing Weather API' }));
        expect(await screen.findByText(/the catalog returned 404/)).toBeTruthy();
    });

    it('closes on Escape', async () => {
        render(<Harness />);
        await screen.findByLabelText('Search APIs');
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.getByText('closed')).toBeTruthy();
    });
});

// ============================================
// Credentials and approval (ported from the old install door)
// ============================================

describe('AddApiDialog: keys and approval', () => {
    it('rejects a pasted document that is not JSON', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Have a spec already? Paste OpenAPI' }));
        fireEvent.change(screen.getByLabelText('OpenAPI document'), { target: { value: '{not json' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(screen.getByText('OpenAPI document must be JSON')).toBeTruthy();
        expect(listCapabilities()).toHaveLength(0);
    });

    it('installs without writing the key into the store; a write lands pending', () => {
        render(<Harness />);
        paste(SPEC);
        fireEvent.change(screen.getByLabelText('Key for https://board.example.test'), { target: { value: 'super-secret-value' } });
        fireEvent.click(screen.getByRole('button', { name: 'Install & place' }));

        const list = listCapabilities().find(m => m.source.operationId === 'listPosts');
        const create = listCapabilities().find(m => m.source.operationId === 'createPost');
        expect(list?.approval).toBe('auto');
        expect(create?.approval).toBe('pending');
        expect(capabilitySecrets.get(list!.auth.secretRef!)).toBe('super-secret-value');
        expect(JSON.stringify(useCapabilityStore.getState())).not.toContain('super-secret-value');
        expect(JSON.stringify(useBlockStore.getState())).not.toContain('super-secret-value');
    });

    it('refuses to install while a key is missing', () => {
        render(<Harness />);
        paste(SPEC);
        fireEvent.click(screen.getByRole('button', { name: 'Install & place' }));
        expect(screen.getByRole('alert').textContent).toBe('Enter the key for https://board.example.test');
        expect(listCapabilities()).toHaveLength(0);
        expect(placedCapabilityBlocks()).toHaveLength(0);
    });

    it('refuses a key over the byte bound and writes nothing to the slot', () => {
        render(<Harness />);
        paste(SPEC);
        fireEvent.change(screen.getByLabelText('Key for https://board.example.test'), { target: { value: 'k'.repeat(MAX_SECRET_BYTES + 1) } });
        fireEvent.click(screen.getByRole('button', { name: 'Install & place' }));
        expect(screen.getByRole('alert').textContent).toBe(`A key is at most ${MAX_SECRET_BYTES} bytes`);
        expect(listCapabilities()).toHaveLength(0);
        const ref = compileOpenApi(SPEC).manifests[0].auth.secretRef!;
        expect(capabilitySecrets.get(ref)).toBeUndefined();
    });

    it('shows where requests go and how the key travels, beside every operation and the key field', () => {
        render(<Harness />);
        paste(SPEC);
        expect(screen.getByText(/Sends requests to/).textContent).toContain('https://board.example.test');
        expect(screen.getAllByText('Key: apiKey in header X-Board-Key')).toHaveLength(2);
        const field = screen.getByLabelText('Key for https://board.example.test').closest('label')!;
        expect(field.textContent).toContain('apiKey in header X-Board-Key');
        expect(field.textContent).not.toContain('/v1');
        expect(screen.queryByText(/travels in the URL/)).toBeNull();
    });

    it('asks for a key the spec passes as a parameter, in its own words', () => {
        render(<Harness />);
        paste({
            openapi: '3.0.0',
            info: { title: 'Get Weather City', version: '1.0.0' },
            servers: [{ url: 'https://api.interzoid.com' }],
            paths: {
                '/getweather': {
                    get: {
                        summary: 'Gets current weather information for a US city and state',
                        parameters: [
                            { name: 'license', in: 'query', required: true, description: 'Your Interzoid license API key. Register at www.interzoid.com/register', schema: { type: 'string' } },
                            { name: 'city', in: 'query', required: true, schema: { type: 'string' } }
                        ],
                        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
                    }
                }
            }
        });
        const field = screen.getByLabelText('Key for https://api.interzoid.com').closest('label')!;
        expect(field.textContent).toContain('query parameter license');
        expect(field.textContent).toContain('The API says: Your Interzoid license API key. Register at www.interzoid.com/register');
        expect(screen.getAllByText(/travels in the URL/).length).toBeGreaterThan(0);
    });

    it('warns when the key will travel in the URL', () => {
        render(<Harness />);
        paste({ ...SPEC, components: { securitySchemes: { boardKey: { type: 'apiKey', in: 'query', name: 'api_key' } } } });
        expect(screen.getAllByText(/travels in the URL/)).toHaveLength(2);
        expect(screen.getAllByText(/apiKey in query parameter api_key/).length).toBeGreaterThan(0);
    });

    it('shows the Authorization header for a bearer scheme', () => {
        render(<Harness />);
        paste({ ...SPEC, components: { securitySchemes: { boardKey: { type: 'http', scheme: 'bearer' } } } });
        expect(screen.getAllByText('Key: bearer in Authorization header')).toHaveLength(2);
    });

    it('installs only the operations you leave selected', () => {
        render(<Harness />);
        paste(SPEC);
        fireEvent.change(screen.getByLabelText('Key for https://board.example.test'), { target: { value: 'session-only' } });
        fireEvent.click(screen.getByLabelText('Install List posts'));
        // Unselecting the operation marked for the canvas leaves nothing to place.
        fireEvent.click(screen.getByRole('button', { name: 'Install' }));
        expect(listCapabilities().map(m => m.source.operationId)).toEqual(['createPost']);
        expect(listCapabilities()[0].approval).toBe('pending');
    });
});

describe('AddApiDialog: Your APIs', () => {
    /** Install the way the product does, so approval rules apply. */
    function installCreatePost() {
        const create = compileOpenApi(SPEC).manifests.find(m => m.source.operationId === 'createPost')!;
        expect(installProposal(create).ok).toBe(true);
    }

    it('approves through its own control, never by installing', () => {
        render(<Harness />);
        act(() => installCreatePost());
        fireEvent.click(screen.getByRole('tab', { name: /Your APIs/ }));
        const list = screen.getByRole('list', { name: 'Installed APIs' });
        expect(within(list).getByText('Waiting for approval')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Approve Create post' }));
        expect(listCapabilities().find(m => m.source.operationId === 'createPost')?.approval).toBe('approved');
        expect(screen.queryByRole('button', { name: 'Approve Create post' })).toBeNull();
    });

    it('removes through a separate control', () => {
        render(<Harness />);
        act(() => installCreatePost());
        fireEvent.click(screen.getByRole('tab', { name: /Your APIs/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove Create post' }));
        expect(listCapabilities()).toHaveLength(0);
    });

    it('names a capability the current rules could not restore, and lets you forget it', () => {
        useCapabilityStore.setState({
            stale: [{ id: 'cap_legacy', title: 'Search board', reason: 'MCP manifests now carry the server origin.', manifest: {} }]
        });
        render(<Harness />);
        fireEvent.click(screen.getByRole('tab', { name: /Your APIs/ }));
        expect(screen.getByText('MCP manifests now carry the server origin.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Forget Search board' }));
        expect(useCapabilityStore.getState().stale).toEqual([]);
    });

    it('counts only APIs a person installed', async () => {
        render(<Harness />);
        act(() => installCreatePost());
        await waitFor(() => expect(screen.getByRole('tab', { name: 'Your APIs (1)' })).toBeTruthy());
    });
});
