// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { getKeylessApis } from '@/core/schemas/api.schema';
import { useSettingsStore } from '@/core/stores/settingsStore';

describe('Settings — demo APIs are named', () => {
    it('lists every keyless connector so settings does not only mention Polymarket', () => {
        render(<SettingsPanel isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Demo APIs (no key)')).toBeTruthy();
        for (const api of getKeylessApis()) {
            expect(screen.getByText(api.name), api.id).toBeTruthy();
        }
    });
});

describe('Settings — the refresh toggle says what it does', () => {
    it('describes the useMockData flag as a live-data polling rate, never as mock data', () => {
        useSettingsStore.setState({ useMockData: true });
        const { unmount } = render(<SettingsPanel isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Fast refresh')).toBeTruthy();
        expect(screen.getByText('Live data, polled every 5–60 s (no mock data exists)')).toBeTruthy();
        expect(screen.queryByText('Use Mock Data')).toBeNull();
        expect(screen.queryByText(/demo data/i)).toBeNull();
        // Substring match over the whole panel, so copy embedded in a longer
        // sentence (the info-box tip) cannot promise a mock mode either.
        expect(document.body.textContent).not.toMatch(/mock data(?!\s+exists)/i);
        unmount();

        useSettingsStore.setState({ useMockData: false });
        render(<SettingsPanel isOpen onClose={vi.fn()} />);
        expect(screen.getByText('Live data, polled every 1–60 min')).toBeTruthy();
    });
});
