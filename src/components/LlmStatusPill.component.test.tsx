// @vitest-environment happy-dom
// ============================================
// The pill showed the provider on a hover-styled button whose click only
// re-pinged. It read as a selector and behaved as a refresh, so the provider
// looked stuck on whatever it was. These lock the fix. The preview has no LLM,
// so the dot is always red and nothing is ever pinged.
// ============================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LlmStatusPill } from './LlmStatusPill';
import { useMindStore } from '@/core/stores/mindStore';
import { LLM_DEFAULTS } from '@/core/schemas/mind.schema';

beforeEach(() => {
    useMindStore.setState({ llmConfig: { ...LLM_DEFAULTS.local } });
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

describe('LlmStatusPill', () => {
    it('shows the active provider', async () => {
        render(<LlmStatusPill />);
        expect(await screen.findByText('local')).toBeTruthy();
    });

    it('opens a provider menu on click', async () => {
        render(<LlmStatusPill />);
        fireEvent.click(await screen.findByTestId('llm-status-pill'));

        // The whole bug: clicking produced no visible affordance.
        expect(screen.getByRole('menu')).toBeTruthy();
        expect(screen.getByText('Anthropic')).toBeTruthy();
        expect(screen.getByText('Google')).toBeTruthy();
    });

    it('switching provider updates the store and the label', async () => {
        render(<LlmStatusPill />);
        fireEvent.click(await screen.findByTestId('llm-status-pill'));
        fireEvent.click(screen.getByText('Google'));

        expect(useMindStore.getState().llmConfig.provider).toBe('google');
        expect(await screen.findByText('google')).toBeTruthy();
    });

    it('closes the menu after choosing', async () => {
        render(<LlmStatusPill />);
        fireEvent.click(await screen.findByTestId('llm-status-pill'));
        fireEvent.click(screen.getByText('Anthropic'));

        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });

    it('pings nothing, on mount or when the provider changes', async () => {
        render(<LlmStatusPill />);
        fireEvent.click(await screen.findByTestId('llm-status-pill'));
        fireEvent.click(screen.getByText('Google'));

        await screen.findByText('google');
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('stays red, and names what would make the selected provider work', async () => {
        render(<LlmStatusPill />);
        const pill = await screen.findByTestId('llm-status-pill');
        expect(pill.querySelector('.bg-\\[var\\(--truth-red\\)\\]')).toBeTruthy();
        expect(pill.getAttribute('title')).toMatch(/start Ollama/i);

        fireEvent.click(pill);
        fireEvent.click(screen.getByText('Google'));
        expect((await screen.findByTestId('llm-status-pill')).getAttribute('title')).toMatch(/set the google API key in \.env/i);
    });

    it('closes on Escape', async () => {
        render(<LlmStatusPill />);
        fireEvent.click(await screen.findByTestId('llm-status-pill'));
        expect(screen.getByRole('menu')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });
});
