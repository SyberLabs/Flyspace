import { describe, it, expect } from 'vitest';
import { DEFAULT_MODEL, resolveModel } from './models.registry';
import { LLM_DEFAULTS } from './schemas/mind.schema';

describe('model registry — integrity', () => {
    it('LLM_DEFAULTS uses the registry defaults (single source of truth)', () => {
        expect(LLM_DEFAULTS.anthropic.model).toBe(DEFAULT_MODEL.anthropic);
        expect(LLM_DEFAULTS.google.model).toBe(DEFAULT_MODEL.google);
        expect(LLM_DEFAULTS.local.model).toBe(DEFAULT_MODEL.local);
    });
});

describe('resolveModel — self-healing', () => {
    it('heals the two ids that shipped live 404s', () => {
        expect(resolveModel('google', 'gemini-2.0-flash-exp')).toBe('gemini-2.5-flash');
        expect(resolveModel('anthropic', 'claude-3-haiku-20240307')).toBe('claude-haiku-4-5-20251001');
    });

    it('falls back to the provider default when empty', () => {
        expect(resolveModel('google')).toBe(DEFAULT_MODEL.google);
        expect(resolveModel('anthropic', '  ')).toBe(DEFAULT_MODEL.anthropic);
    });

    it('passes through unlisted (potentially valid) ids untouched', () => {
        expect(resolveModel('local', 'qwen2.5:14b')).toBe('qwen2.5:14b');
        expect(resolveModel('google', 'gemini-9-ultra')).toBe('gemini-9-ultra');
    });
});
