import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// A stand-in for the socket layer: nothing in this file opens a connection.
interface FakeRequest extends EventEmitter {
    destroy: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
}
const created = vi.hoisted(() => [] as FakeRequest[]);

vi.mock('node:https', () => {
    const request = vi.fn(() => {
        const emitter = new EventEmitter();
        const req = Object.assign(emitter, {
            destroy: vi.fn((error?: Error) => {
                if (error) emitter.emit('error', error);
            }),
            end: vi.fn(),
            write: vi.fn()
        });
        created.push(req);
        return req;
    });
    return { default: { request }, request };
});

import { pinnedFetch } from './pinnedFetch';

const target = {
    url: new URL('https://board.example.test/items'),
    address: '203.0.113.10',
    method: 'GET',
    headers: {},
    maxBytes: 1000
};

describe('pinnedFetch abort', () => {
    it('destroys the outgoing request and rejects when the signal aborts', async () => {
        const controller = new AbortController();
        const before = created.length;
        const pending = pinnedFetch({ ...target, signal: controller.signal });
        const req = created[before];
        expect(req.end).toHaveBeenCalled();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(req.destroy).toHaveBeenCalled();
    });

    it('does not send a request whose signal already aborted', async () => {
        const before = created.length;
        await expect(pinnedFetch({ ...target, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
        expect(created[before].end).not.toHaveBeenCalled();
        expect(created[before].destroy).toHaveBeenCalled();
    });
});
