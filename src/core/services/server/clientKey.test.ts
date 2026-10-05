import { describe, expect, it } from 'vitest';
import { clientKey, declaredIngress, DIRECT_CLIENT, type ClientKeyEnv } from './clientKey';

const UNDECLARED: ClientKeyEnv = {};
const CLOUDFLARE: ClientKeyEnv = { OMNI_TRUSTED_PROXY: 'cloudflare' };
const PROXY: ClientKeyEnv = { OMNI_TRUSTED_PROXY: 'proxy' };
const ALL_HEADERS = { 'cf-connecting-ip': '198.51.100.42', 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '192.0.2.1, 198.51.100.9' };

function request(headers: Record<string, string>): Request {
    return new Request('http://localhost:3000/api/capability-broker', { method: 'POST', headers });
}

describe('clientKey', () => {
    it('puts a request with no address headers in the direct bucket under every ingress', () => {
        for (const env of [UNDECLARED, CLOUDFLARE, PROXY]) {
            expect(clientKey(request({}), env)).toBe(DIRECT_CLIENT);
        }
    });

    it('ignores every address header when no ingress is declared', () => {
        // Off Cloudflare and without a proxy, all three are client-writable. N forged
        // addresses share one per-caller budget: they all key to the same bucket.
        expect(clientKey(request(ALL_HEADERS), UNDECLARED)).toBe(DIRECT_CLIENT);
        for (const address of ['192.0.2.1', '198.51.100.9', '203.0.113.5, 203.0.113.6']) {
            expect(clientKey(request({ 'cf-connecting-ip': address }), UNDECLARED)).toBe(DIRECT_CLIENT);
            expect(clientKey(request({ 'x-forwarded-for': address }), UNDECLARED)).toBe(DIRECT_CLIENT);
            expect(clientKey(request({ 'x-real-ip': address }), UNDECLARED)).toBe(DIRECT_CLIENT);
        }
    });

    it('under cloudflare uses cf-connecting-ip and nothing else', () => {
        expect(clientKey(request(ALL_HEADERS), CLOUDFLARE)).toBe('198.51.100.42');
        // The edge always sets it, so a request without it did not come through the edge.
        expect(clientKey(request({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '192.0.2.1' }), CLOUDFLARE)).toBe(DIRECT_CLIENT);
    });

    it('under proxy uses x-real-ip, then the last x-forwarded-for hop, and never cf-connecting-ip', () => {
        expect(clientKey(request(ALL_HEADERS), PROXY)).toBe('198.51.100.7');
        expect(clientKey(request({ 'x-forwarded-for': '192.0.2.1, 198.51.100.9' }), PROXY)).toBe('198.51.100.9');
        expect(clientKey(request({ 'x-forwarded-for': ' 192.0.2.1 , , ' }), PROXY)).toBe('192.0.2.1');
        expect(clientKey(request({ 'cf-connecting-ip': '198.51.100.42' }), PROXY)).toBe(DIRECT_CLIENT);
    });

    it('bounds the key length', () => {
        expect(clientKey(request({ 'cf-connecting-ip': 'a'.repeat(200) }), CLOUDFLARE)).toHaveLength(64);
        expect(clientKey(request({ 'x-forwarded-for': 'b'.repeat(200) }), PROXY)).toHaveLength(64);
    });

    it('reads the ingress declaration, with "1" as the older spelling of proxy', () => {
        expect(declaredIngress({})).toBe('direct');
        expect(declaredIngress({ OMNI_TRUSTED_PROXY: '0' })).toBe('direct');
        expect(declaredIngress({ OMNI_TRUSTED_PROXY: 'true' })).toBe('direct');
        expect(declaredIngress({ OMNI_TRUSTED_PROXY: '1' })).toBe('proxy');
        expect(declaredIngress({ OMNI_TRUSTED_PROXY: ' Proxy ' })).toBe('proxy');
        expect(declaredIngress({ OMNI_TRUSTED_PROXY: 'Cloudflare' })).toBe('cloudflare');
    });
});
