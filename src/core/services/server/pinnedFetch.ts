// Connect to an address that egress already approved, with the original
// hostname as Host and TLS SNI. The platform resolver does not get a second
// chance to answer with a private address.

import http from 'node:http';
import https from 'node:https';

export interface PinnedRequest {
    url: URL;
    address: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    maxBytes: number;
}

export interface PinnedResponse {
    status: number;
    headers: Record<string, string>;
    text: string;
}

export async function pinnedFetch(request: PinnedRequest): Promise<PinnedResponse> {
    const transport = request.url.protocol === 'https:' ? https : http;
    const hostHeader = request.url.host;
    return new Promise((resolve, reject) => {
        const req = transport.request({
            host: request.address,
            servername: request.url.hostname,
            port: request.url.port || (request.url.protocol === 'https:' ? 443 : 80),
            method: request.method,
            path: `${request.url.pathname}${request.url.search}`,
            headers: { ...request.headers, host: hostHeader },
            timeout: 15_000
        }, (res) => {
            const declared = Number(res.headers['content-length'] ?? '');
            if (Number.isFinite(declared) && declared > request.maxBytes) {
                res.resume();
                req.destroy();
                reject(new Error('Response exceeded 1MB'));
                return;
            }
            const chunks: Buffer[] = [];
            let seen = 0;
            res.on('data', (chunk: Buffer) => {
                seen += chunk.length;
                if (seen > request.maxBytes) {
                    res.destroy();
                    reject(new Error('Response exceeded 1MB'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                const headers: Record<string, string> = {};
                for (const [key, value] of Object.entries(res.headers)) {
                    if (typeof value === 'string') headers[key] = value;
                    else if (Array.isArray(value)) headers[key] = value.join(', ');
                }
                resolve({
                    status: res.statusCode ?? 0,
                    headers,
                    text: Buffer.concat(chunks).toString('utf8')
                });
            });
            res.on('error', reject);
        });
        const abort = () => {
            req.destroy(new DOMException('The operation was aborted', 'AbortError'));
        };
        if (request.signal?.aborted) {
            abort();
            return;
        }
        request.signal?.addEventListener('abort', abort, { once: true });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Broker request timed out')));
        if (request.body !== undefined) req.write(request.body);
        req.end();
    });
}
