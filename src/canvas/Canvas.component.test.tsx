// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useBlockStore } from '@/core/stores';

// The empty canvas is the first screen a visitor sees. The public preview
// has no LLM (/api/llm answers 503), so it must not promise answers.
describe('Canvas empty state copy', () => {
    beforeEach(() => {
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('in the public preview, says what works and that asking needs your own LLM', () => {
        vi.stubEnv('NEXT_PUBLIC_OMNI_PUBLIC_DEMO', '1');
        render(<Canvas onBrowseShells={() => {}} />);
        expect(screen.getByText(/explore the live data and rewire it/i)).toBeTruthy();
        expect(screen.getByText(/asking a persona needs Flyspace running with your own LLM/i)).toBeTruthy();
        expect(screen.queryByText(/immediately/i)).toBeNull();
    });

    it('outside the preview, does not promise an answer without an LLM', () => {
        vi.stubEnv('NEXT_PUBLIC_OMNI_PUBLIC_DEMO', '');
        render(<Canvas onBrowseShells={() => {}} />);
        expect(screen.getByText(/ready for a question once an LLM is connected/i)).toBeTruthy();
        expect(screen.queryByText(/immediately/i)).toBeNull();
    });
});
