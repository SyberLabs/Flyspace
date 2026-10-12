import { describe, expect, it } from 'vitest';
import { credentialSlot } from './identity';
import { compileOpenApi } from './openapi';

const READ = 'https://www.googleapis.com/auth/calendar.readonly';
const EVENTS_READ = 'https://www.googleapis.com/auth/calendar.events.readonly';
const FULL = 'https://www.googleapis.com/auth/calendar';

/** Google's shape: an implicit and an authorizationCode scheme, paired in every requirement. */
function googleSpec(options: { server?: string; authorizationUrl?: string; getScopes?: string[][]; post?: boolean } = {}) {
    const authorizationUrl = options.authorizationUrl ?? 'https://accounts.google.com/o/oauth2/auth';
    const scopes = { [FULL]: 'all', [READ]: 'read', [EVENTS_READ]: 'read events' };
    const pair = (list: string[]) => ({ Oauth2: list, Oauth2c: list });
    const ok = { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { summary: { type: 'string' } } } } } } };
    return {
        openapi: '3.0.0',
        info: { title: 'Calendar', version: 'v3' },
        servers: [{ url: options.server ?? 'https://www.googleapis.com/calendar/v3' }],
        components: {
            securitySchemes: {
                Oauth2: { type: 'oauth2', flows: { implicit: { authorizationUrl, scopes } } },
                Oauth2c: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl, tokenUrl: 'https://accounts.google.com/o/oauth2/token', scopes } } }
            }
        },
        paths: {
            '/calendars/{calendarId}': {
                get: {
                    operationId: 'calendar.calendars.get',
                    parameters: [{ name: 'calendarId', in: 'path', required: true, schema: { type: 'string' } }],
                    security: (options.getScopes ?? [[FULL], [EVENTS_READ, READ], [READ]]).map(pair),
                    responses: ok
                },
                ...(options.post ? {
                    post: {
                        operationId: 'calendar.calendars.update',
                        parameters: [{ name: 'calendarId', in: 'path', required: true, schema: { type: 'string' } }],
                        security: [pair([FULL])],
                        responses: ok
                    }
                } : {})
            }
        }
    };
}

describe('compiling a Google sign-in', () => {
    it('binds a read operation to its narrowest read-only scope, browser direct, in its own slot', () => {
        const { manifests, errors } = compileOpenApi(googleSpec());
        expect(errors).toEqual([]);
        const [manifest] = manifests;
        expect(manifest.effect).toBe('read');
        expect(manifest.auth).toEqual({
            kind: 'oauth',
            scopes: [READ],
            secretRef: credentialSlot('https://www.googleapis.com/calendar/v3', { kind: 'oauth', scopes: [READ] })
        });
        expect(manifest.transport.kind === 'http' && manifest.transport.access).toBe('browser_direct');
    });

    it('never routes a sign-in through the broker, even for a host the app brokers', () => {
        const [manifest] = compileOpenApi(googleSpec(), { brokerOrigins: ['https://www.googleapis.com'] }).manifests;
        expect(manifest.transport.kind === 'http' && manifest.transport.access).toBe('browser_direct');
    });

    it('refuses a write operation that needs a sign-in', () => {
        const { manifests, errors } = compileOpenApi(googleSpec({ post: true }));
        expect(manifests.map(manifest => manifest.source.operationId)).toEqual(['calendar.calendars.get']);
        expect(errors.map(error => error.message)).toContain('Signed-in operations are read-only in Flyspace; this one can change data');
    });

    it('refuses a read operation whose only scopes can change data', () => {
        const { manifests, errors } = compileOpenApi(googleSpec({ getScopes: [[FULL]] }));
        expect(manifests).toEqual([]);
        expect(errors[0].message).toBe('It needs a sign-in that can change your data; Flyspace only asks for read-only access');
    });

    it('refuses a Google sign-in declared for a server that is not Google\'s', () => {
        const { manifests, errors } = compileOpenApi(googleSpec({ server: 'https://collector.example.test/v3' }));
        expect(manifests).toEqual([]);
        expect(errors[0].message).toMatch(/declared for a server that is not Google's/);
    });

    it('refuses a sign-in with a provider Flyspace cannot connect to', () => {
        const { manifests, errors } = compileOpenApi(googleSpec({ authorizationUrl: 'https://login.example.test/authorize' }));
        expect(manifests).toEqual([]);
        expect(errors[0].message).toMatch(/OAuth sign-in Flyspace cannot connect to/);
    });
});
