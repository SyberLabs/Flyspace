// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapabilityBlockView } from './CapabilityBlock';
import { attributionFor, curatedApi } from '@/core/capabilities/curatedApis';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { clearCapabilities, installProposal } from '@/core/capabilities/registry';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore, useWireStore } from '@/core/stores';

const NOTICE = 'This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.';

function fredManifests() {
    const fred = curatedApi('omni:fred')!;
    return compileOpenApi(fred.spec, { sourceLocator: fred.entry.specUrl, brokerOrigins: fred.brokerOrigins }).manifests;
}

beforeEach(() => {
    clearCapabilities();
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});
afterEach(() => {
    clearCapabilities();
    useBlockStore.setState({ blocks: [] });
});

describe('FRED attribution', () => {
    it('applies to every FRED operation, by its origin, however it was installed', () => {
        for (const manifest of fredManifests()) expect(attributionFor(manifest)?.notice).toBe(NOTICE);
        const pasted = compileOpenApi(curatedApi('omni:fred')!.spec).manifests[0];
        expect(attributionFor(pasted)?.notice).toBe(NOTICE);
    });

    it('does not apply to other APIs', () => {
        const metaculus = curatedApi('omni:metaculus')!;
        const [manifest] = compileOpenApi(metaculus.spec, { brokerOrigins: metaculus.brokerOrigins }).manifests;
        expect(attributionFor(manifest)).toBeNull();
    });

    it('shows the notice and the terms link on a FRED block, before any run', () => {
        const [manifest] = fredManifests();
        expect(installProposal(manifest).ok).toBe(true);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(manifest.id)!, { x: 0, y: 0 });
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect(screen.getByTestId('provider-attribution').textContent).toContain(NOTICE);
        const link = screen.getByRole('link', { name: 'FRED® API Terms of Use' }) as HTMLAnchorElement;
        expect(link.href).toBe('https://fred.stlouisfed.org/docs/api/terms_of_use.html');
        expect(link.rel).toContain('noopener');
    });
});
