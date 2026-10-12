// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { clearCapabilities, installProposal } from '@/core/capabilities/registry';
import { capabilitySecrets } from '@/core/capabilities/secrets';
import { curatedApi } from '@/core/capabilities/curatedApis';
import { KEY_VAULT_DB, keyVaultSettled, resetKeyVaultForTests, startKeyVault } from '@/core/capabilities/keyVault';
import { YourApis } from './YourApis';

beforeEach(async () => {
    resetKeyVaultForTests();
    clearCapabilities();
    capabilitySecrets.clear();
    indexedDB.deleteDatabase(KEY_VAULT_DB);
    await startKeyVault();
    const fred = curatedApi('omni:fred')!;
    for (const manifest of compileOpenApi(fred.spec, { sourceLocator: fred.entry.specUrl, brokerOrigins: fred.brokerOrigins }).manifests) {
        installProposal(manifest);
    }
});

afterEach(async () => {
    await keyVaultSettled();
    resetKeyVaultForTests();
    clearCapabilities();
    capabilitySecrets.clear();
});

describe('Remember keys on this device', () => {
    it('is off until turned on, then says the keys are kept encrypted here', async () => {
        render(<YourApis onPlace={() => {}} />);
        const toggle = screen.getByRole('checkbox', { name: 'Remember keys on this device' }) as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        expect(screen.getByText(/Off: keys last for this session only/)).toBeTruthy();

        await act(async () => { fireEvent.click(toggle); });
        await waitFor(() => expect(toggle.checked).toBe(true));
        expect(screen.getByText(/stored encrypted in this browser, with a key it cannot export/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Enter key for https:\/\/api.stlouisfed.org/ }));
        expect(screen.getByText('Remembered on this device, encrypted. Never saved with your canvas.')).toBeTruthy();
    });

    it('turning it off says keys last one session again', async () => {
        render(<YourApis onPlace={() => {}} />);
        const toggle = screen.getByRole('checkbox', { name: 'Remember keys on this device' }) as HTMLInputElement;
        await act(async () => { fireEvent.click(toggle); });
        await waitFor(() => expect(toggle.checked).toBe(true));
        // The switch is disabled while the first save finishes.
        await waitFor(() => expect(toggle.disabled).toBe(false));
        await act(async () => { fireEvent.click(toggle); });
        await waitFor(() => expect(toggle.checked).toBe(false));
        expect(screen.getByText(/Off: keys last for this session only/)).toBeTruthy();
    });
});
