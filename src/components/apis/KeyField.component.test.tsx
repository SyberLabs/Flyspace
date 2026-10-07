// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CapabilityBlockView } from '@/blocks/capability/CapabilityBlock';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { clearCapabilities, installProposal } from '@/core/capabilities/registry';
import { MAX_SECRET_BYTES, capabilitySecrets } from '@/core/capabilities/secrets';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore, useWireStore } from '@/core/stores';
import { YourApis } from './YourApis';

// Interzoid's shape: the key is a parameter, so it compiles to a query key slot.
const SPEC = {
    openapi: '3.0.0',
    info: { title: 'Get Weather City', version: '1.0.0' },
    servers: [{ url: 'https://api.interzoid.com' }],
    paths: {
        '/getweather': {
            get: {
                summary: 'Current weather for a US city',
                parameters: [
                    { name: 'license', in: 'query', required: true, description: 'Your Interzoid license API key. Register at www.interzoid.com/register', schema: { type: 'string' } },
                    { name: 'city', in: 'query', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
        },
        '/getforecast': {
            get: {
                summary: 'Forecast for a US city',
                parameters: [
                    { name: 'license', in: 'query', required: true, description: 'Your Interzoid license API key.', schema: { type: 'string' } },
                    { name: 'city', in: 'query', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
        }
    }
};

const KEY_LABEL = 'Key for https://api.interzoid.com';
let requests: string[];
let status: number;

function install() {
    const manifests = compileOpenApi(SPEC).manifests;
    for (const manifest of manifests) expect(installProposal(manifest).ok).toBe(true);
    return manifests;
}

function placeWeather() {
    const [weather] = install();
    const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(weather.id)!, { x: 0, y: 0 });
    useBlockStore.getState().setParams(instanceId, { city: 'Seattle' });
    return { manifest: weather, instanceId };
}

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
    requests = [];
    status = 200;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(status === 200 ? '{"Weather":"Light rain"}' : '{"error":"bad license"}', {
            status, headers: { 'content-type': 'application/json' }
        });
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    clearCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [] });
});

describe('a keyed block with no key this session', () => {
    it('asks for the key in place of running, in the spec\'s words, and runs once it has it', async () => {
        const { manifest, instanceId } = placeWeather();
        render(<CapabilityBlockView instanceId={instanceId} />);

        expect(screen.getByText('This API needs its key.')).toBeTruthy();
        expect(screen.getByText(/The API says: Your Interzoid license API key/)).toBeTruthy();
        const run = screen.getByRole('button', { name: 'Enter the key' }) as HTMLButtonElement;
        expect(run.disabled).toBe(true);

        fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: '  my-license  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

        expect(screen.queryByText('This API needs its key.')).toBeNull();
        expect(capabilitySecrets.get(manifest.auth.secretRef!)).toBe('my-license');
        expect(JSON.stringify(useBlockStore.getState().blocks)).not.toContain('my-license');

        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        await screen.findByText('Light rain');
        expect(new URL(requests[0]).searchParams.get('license')).toBe('my-license');
    });

    it('shows the prompt, not the executor\'s slot error, after a reload empties the slot', () => {
        const { instanceId } = placeWeather();
        useBlockStore.getState().updateStatus(instanceId, 'error', 'Secret slot apikey:https://api.interzoid.com:query:license is empty');
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect(screen.getByText('This API needs its key.')).toBeTruthy();
        expect(screen.queryByText(/Secret slot/)).toBeNull();
    });

    it('refuses an empty or oversized key and leaves the slot empty', () => {
        const { manifest, instanceId } = placeWeather();
        render(<CapabilityBlockView instanceId={instanceId} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        expect(screen.getByRole('alert').textContent).toBe('Enter the key first');
        fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: 'k'.repeat(MAX_SECRET_BYTES + 1) } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        expect(screen.getByRole('alert').textContent).toBe(`A key is at most ${MAX_SECRET_BYTES} bytes`);
        expect(capabilitySecrets.has(manifest.auth.secretRef!)).toBe(false);
    });
});

describe('changing a key the API refused', () => {
    it('offers "Change key" on a 401 or 403, and the next run sends the new key', async () => {
        status = 403;
        const { manifest, instanceId } = placeWeather();
        capabilitySecrets.set(manifest.auth.secretRef!, 'wrong-license');
        render(<CapabilityBlockView instanceId={instanceId} />);

        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Change key' }));
        fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: 'right-license' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        expect(screen.queryByLabelText(KEY_LABEL)).toBeNull();

        status = 200;
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        await screen.findByText('Light rain');
        expect(new URL(requests.at(-1)!).searchParams.get('license')).toBe('right-license');
    });

    it('does not offer it for errors a key cannot fix', async () => {
        status = 404;
        const { manifest, instanceId } = placeWeather();
        capabilitySecrets.set(manifest.auth.secretRef!, 'a-license');
        render(<CapabilityBlockView instanceId={instanceId} />);
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        await screen.findByRole('alert');
        expect(screen.queryByRole('button', { name: 'Change key' })).toBeNull();
    });
});

describe('Your APIs: keys', () => {
    it('lists one key for operations that share it, and enters, changes, and forgets it', () => {
        const [weather] = install();
        render(<YourApis onPlace={() => {}} />);

        const keys = screen.getByRole('region', { name: 'Keys' });
        expect(keys.textContent).toContain('Not entered this session');
        expect(keys.textContent).toContain('used by 2 operations');

        fireEvent.click(screen.getByRole('button', { name: 'Enter key for https://api.interzoid.com' }));
        fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: 'first' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        expect(keys.textContent).toContain('Entered for this session');
        expect(capabilitySecrets.get(weather.auth.secretRef!)).toBe('first');

        fireEvent.click(screen.getByRole('button', { name: 'Forget key for https://api.interzoid.com' }));
        expect(keys.textContent).toContain('Not entered this session');
        expect(capabilitySecrets.has(weather.auth.secretRef!)).toBe(false);
    });

    it('follows a key set elsewhere, such as from a block', () => {
        const [weather] = install();
        render(<YourApis onPlace={() => {}} />);
        act(() => capabilitySecrets.set(weather.auth.secretRef!, 'from-the-block'));
        expect(screen.getByRole('region', { name: 'Keys' }).textContent).toContain('Entered for this session');
    });
});
