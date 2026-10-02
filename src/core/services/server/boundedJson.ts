// Read a JSON request body without trusting its size or its pace. Stops at
// maxBytes and stops when the signal aborts, then cancels the stream.

export class RequestBodyTooLarge extends Error {
    constructor() {
        super('request body too large');
        this.name = 'RequestBodyTooLarge';
    }
}

export async function readBoundedJson(request: Request, signal: AbortSignal, maxBytes: number): Promise<unknown> {
    if (!request.body) throw new Error('empty request body');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let consumed = false;
    const abortRead = () => { void reader.cancel(signal.reason).catch(() => undefined); };
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const failRead = () => rejectAbort(signal.reason);
    signal.addEventListener('abort', abortRead, { once: true });
    signal.addEventListener('abort', failRead, { once: true });
    try {
        while (true) {
            if (signal.aborted) throw signal.reason;
            const result = await Promise.race([reader.read(), aborted]);
            if (result.done) { consumed = true; break; }
            size += result.value.byteLength;
            if (size > maxBytes) throw new RequestBodyTooLarge();
            chunks.push(result.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
        signal.removeEventListener('abort', abortRead);
        signal.removeEventListener('abort', failRead);
        if (!consumed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
