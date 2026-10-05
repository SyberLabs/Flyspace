import { describe, expect, it } from 'vitest';
import { clientKey, DIRECT_CLIENT, trustedProxyDeclared, type ClientKeyEnv } from './clientKey';

const NO_PROXY: ClientKeyEnv = {};
const PROXY: ClientKeyEnv = { OMNI_TRUSTED_PROXY: '1' };

function request(headers: Record<string, string>): Request {
    return new Request('http://localhost:3000/api/capability-broker', { method: 'POST', headers });
}

describe('clientKey', () => {
    it('puts a request with no address headers in the direct bucket', () => {
        expect(clientKey(request({}), NO_PROXY)).toBe(DIRECT_CLIENT);
        expect(clientKey(request({}), PROXY)).toBe(DIRECT_CLIENT);
    });

    it('ignores a forged x-forwarded-for and x-real-ip when no proxy is trusted', () => {
        // N forged addresses share one per-caller budget: they all key to the same bucket.
        const forged = ['192.0.2.1', '198.51.100.9', '203.0.113.5, 203.0.113.6'];
        for (const address of forged) {
            expect(clientKey(request({ 'x-forwarded-for': address }), NO_PROXY)).toBe(DIRECT_CLIENT);
            expect(clientKey(request({ 'x-real-ip': address }), NO_PROXY)).toBe(DIRECT_CLIENT);
        }
    });

    it('prefers cf-connecting-ip over x-forwarded-for, with or without a trusted proxy', () => {
        const headers = { 'cf-connecting-ip': '198.51.100.42', 'x-forwarded-for': '192.0.2.1, 10.0.0.9', 'x-real-ip': '10.0.0.9' };
        expect(clientKey(request(headers), NO_PROXY)).toBe('198.51.100.42');
        expect(clientKey(request(headers), PROXY)).toBe('198.51.100.42');
    });

    it('uses x-real-ip, then the last x-forwarded-for hop, when a proxy is trusted', () => {
        expect(clientKey(request({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '192.0.2.1' }), PROXY)).toBe('198.51.100.7');
        expect(clientKey(request({ 'x-forwarded-for': '192.0.2.1, 198.51.100.9' }), PROXY)).toBe('198.51.100.9');
        expect(clientKey(request({ 'x-forwarded-for': ' 192.0.2.1 , , ' }), PROXY)).toBe('192.0.2.1');
    });

    it('bounds the key length', () => {
        expect(clientKey(request({ 'cf-connecting-ip': 'a'.repeat(200) }), NO_PROXY)).toHaveLength(64);
        expect(clientKey(request({ 'x-forwarded-for': 'b'.repeat(200) }), PROXY)).toHaveLength(64);
    });

    it('reads the trusted-proxy flag as exactly "1"', () => {
        expect(trustedProxyDeclared({})).toBe(false);
        expect(trustedProxyDeclared({ OMNI_TRUSTED_PROXY: '0' })).toBe(false);
        expect(trustedProxyDeclared({ OMNI_TRUSTED_PROXY: 'true' })).toBe(false);
        expect(trustedProxyDeclared({ OMNI_TRUSTED_PROXY: ' 1 ' })).toBe(true);
    });
});
