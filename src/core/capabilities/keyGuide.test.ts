import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkKeyFormat, firstLink, keyGuideFor, testKey } from './keyGuide';
import { curatedApi } from './curatedApis';
import { compileOpenApi } from './openapi';
import { clearCapabilities, installProposal } from './registry';
import { capabilitySecrets } from './secrets';

const fred = curatedApi('omni:fred')!;
const alpha = curatedApi('omni:alpha-vantage')!;
const compiled = (api: typeof fred) => compileOpenApi(api.spec, { sourceLocator: api.entry.specUrl, brokerOrigins: api.brokerOrigins }).manifests;

describe('firstLink', () => {
    it('finds the link in a key description, as https', () => {
        expect(firstLink('Your Interzoid license API key. Register at www.interzoid.com/register')).toBe('https://www.interzoid.com/register');
        expect(firstLink('Claim one at https://www.alphavantage.co/support/#api-key.')).toBe('https://www.alphavantage.co/support/#api-key');
        expect(firstLink('Get it from http://example.test/keys')).toBe('https://example.test/keys');
        expect(firstLink('Your API key')).toBeNull();
        expect(firstLink(undefined)).toBeNull();
    });
});

describe('keyGuideFor', () => {
    it('gives a curated API the guide written from its provider', () => {
        const guide = keyGuideFor(compiled(fred)[0])!;
        expect(guide.source).toBe('provider');
        expect(guide.url).toBe('https://fredaccount.stlouisfed.org/apikeys');
        expect(guide.requires).toMatch(/free FRED account/);
    });

    it('gives any other API the link from its own key description', () => {
        const spec = {
            openapi: '3.0.0', info: { title: 'Weather', version: '1' }, servers: [{ url: 'https://api.interzoid.com' }],
            paths: { '/getweather': { get: {
                parameters: [{ name: 'license', in: 'query', required: true, description: 'Your Interzoid license API key. Register at www.interzoid.com/register', schema: { type: 'string' } }],
                responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
            } } }
        };
        expect(keyGuideFor(compileOpenApi(spec).manifests[0])).toMatchObject({ url: 'https://www.interzoid.com/register', source: 'spec' });
    });

    it('has nothing to say for a keyless API', () => {
        expect(keyGuideFor(compiled(curatedApi('omni:bls')!)[0])).toBeNull();
    });
});

describe('checkKeyFormat', () => {
    const guide = keyGuideFor(compiled(fred)[0]);

    it('warns, without blocking, when a key does not match the documented format', () => {
        expect(checkKeyFormat(guide, 'abc123')).toMatch(/32 lowercase letters and digits/);
        expect(checkKeyFormat(guide, 'a'.repeat(32))).toBeNull();
        expect(checkKeyFormat(guide, '')).toBeNull();
    });

    it('says nothing where the provider documents no format', () => {
        expect(checkKeyFormat(keyGuideFor(compiled(alpha)[0]), 'anything')).toBeNull();
    });
});

describe('testKey', () => {
    let answer: { status: number; body: unknown };

    beforeEach(() => {
        clearCapabilities();
        capabilitySecrets.clear();
        answer = { status: 200, body: { 'Global Quote': { '01. symbol': 'IBM', '05. price': '220.51' } } };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        clearCapabilities();
        capabilitySecrets.clear();
    });

    function installAlpha(): (operationId: string) => string | undefined {
        const manifests = compiled(alpha);
        for (const manifest of manifests) expect(installProposal(manifest).ok).toBe(true);
        capabilitySecrets.set(manifests[0].auth.secretRef!, 'MYKEY');
        return operationId => manifests.find(m => m.source.operationId === operationId)?.id;
    }

    it('says the key works when the API answers with data', async () => {
        const guide = { ...keyGuideFor(compiled(alpha)[0])!, test: { operationId: 'query', input: { function: 'GLOBAL_QUOTE', symbol: 'MSFT' } } };
        expect(await testKey(guide, installAlpha())).toEqual({ ok: true, message: 'The key works: the API answered the test call.' });
    });

    it('does not claim the key is yours when the provider answers any key (Alpha Vantage)', async () => {
        const guide = keyGuideFor(compiled(alpha)[0])!;
        expect(await testKey(guide, installAlpha())).toEqual({
            ok: true,
            message: 'The API answered. It accepts any key on this call, so this does not prove the key is yours.'
        });
    });

    it('reports a refusal', async () => {
        answer = { status: 403, body: { error: 'bad key' } };
        const result = await testKey(keyGuideFor(compiled(alpha)[0])!, installAlpha());
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/refused the test call: HTTP 403/);
    });

    it('catches a key refused with a 200 and a notice, as Alpha Vantage does', async () => {
        answer = { status: 200, body: { Information: 'The API key is invalid.' } };
        const result = await testKey(keyGuideFor(compiled(alpha)[0])!, installAlpha());
        expect(result).toEqual({ ok: false, message: 'The API answered with a notice instead of data: The API key is invalid.' });
    });

    it('needs the operation the test uses to be installed', async () => {
        const result = await testKey(keyGuideFor(compiled(alpha)[0])!, () => undefined);
        expect(result).toEqual({ ok: false, message: 'Install the operation the test uses first.' });
    });
});
