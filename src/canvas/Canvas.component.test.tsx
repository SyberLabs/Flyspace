// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useBlockStore } from '@/core/stores';

// The empty canvas is the first screen a visitor sees. The public preview
// has no LLM (/api/llm answers 503), so it must not promise answers.
describe('Canvas empty state copy', () => {
    beforeEach(() => {
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });

    it('says what works and that asking needs your own LLM', () => {
        render(<Canvas onBrowseShells={() => {}} />);
        expect(screen.getByText(/explore the live data and rewire it/i)).toBeTruthy();
        expect(screen.getByText(/asking a persona needs Flyspace running with your own LLM/i)).toBeTruthy();
        expect(screen.queryByText(/immediately/i)).toBeNull();
    });
});
