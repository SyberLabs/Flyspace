// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CapabilityBlockView } from './CapabilityBlock';
import { curatedApi } from '@/core/capabilities/curatedApis';
import { setHouseKeysForTests } from '@/core/capabilities/houseKeys';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { clearCapabilities, installProposal } from '@/core/capabilities/registry';
import { capabilitySecrets } from '@/core/capabilities/secrets';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore, useWireStore } from '@/core/stores';

function placeFredSeries(): { manifest: CapabilityManifest; instanceId: string } {
    const fred = curatedApi('omni:fred')!;
    const manifests = compileOpenApi(fred.spec, { sourceLocator: fred.entry.specUrl, brokerOrigins: fred.brokerOrigins }).manifests;
    for (const manifest of manifests) expect(installProposal(manifest).ok).toBe(true);
    const manifest = manifests.find(entry => entry.inputs.some(input => input.name === 'series_id' && input.required))!;
    const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(manifest.id)!, { x: 0, y: 0 });
    useBlockStore.getState().setParams(instanceId, { series_id: 'UNRATE' });
    return { manifest, instanceId };
}

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    setHouseKeysForTests([]);
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    vi.unstubAllGlobals();
    setHouseKeysForTests([]);
    clearCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [] });
});

describe('a curated block this server has its own key for', () => {
    it('runs without asking for a key, says the key is the server\'s and shared, and offers your own', () => {
        const { manifest, instanceId } = placeFredSeries();
        setHouseKeysForTests([manifest.digest]);
        render(<CapabilityBlockView instanceId={instanceId} />);

        expect(screen.queryByText('This API needs its key.')).toBeNull();
        expect(screen.getByText(/Runs on this server's key\. It is shared/)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Use my own key' }));
        expect(screen.getByRole('button', { name: 'Save key' })).toBeTruthy();
    });

    it('asks for a key as before when the server has none', () => {
        const { instanceId } = placeFredSeries();
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect(screen.getByText('This API needs its key.')).toBeTruthy();
        expect(screen.queryByText(/Runs on this server's key/)).toBeNull();
    });

    it('updates when coverage arrives after the block is on the canvas', () => {
        const { manifest, instanceId } = placeFredSeries();
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect(screen.getByText('This API needs its key.')).toBeTruthy();
        act(() => setHouseKeysForTests([manifest.digest]));
        expect(screen.queryByText('This API needs its key.')).toBeNull();
    });
});
