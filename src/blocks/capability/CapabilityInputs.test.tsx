// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CapabilityBlockView } from './CapabilityBlock';
import { argumentsFrom, bodyFields, CapabilityInputs, coerceInput, inputSummaryOf, missingInputs } from './CapabilityInputs';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { clearCapabilities, installProposal } from '@/core/capabilities/registry';
import type { CapabilityInput } from '@/core/capabilities/manifest';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore, useWireStore } from '@/core/stores';

// The shape of Interzoid's "Get Weather City": two required query strings.
const WEATHER_SPEC = {
    openapi: '3.0.0',
    info: { title: 'Weather City', version: '1' },
    servers: [{ url: 'https://api.weather.example.test' }],
    paths: {
        '/getweather': {
            get: {
                summary: 'Current weather for a US city',
                parameters: [
                    { name: 'city', in: 'query', required: true, schema: { type: 'string' } },
                    { name: 'state', in: 'query', required: true, schema: { type: 'string', enum: ['CA', 'NY', 'WA'] } },
                    { name: 'days', in: 'query', required: false, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
            }
        }
    }
};

function placeWeatherBlock(): string {
    const manifest = compileOpenApi(WEATHER_SPEC).manifests[0];
    expect(installProposal(manifest).ok).toBe(true);
    return useBlockStore.getState().addBlock(blockRegistry.get(manifest.id)!, { x: 0, y: 0 });
}

let requests: string[];

beforeEach(() => {
    clearCapabilities();
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
    requests = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ City: 'Seattle', TempF: 54, Weather: 'Light rain', Wind: { mph: 7 } }), {
            status: 200, headers: { 'content-type': 'application/json' }
        });
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    clearCapabilities();
    useBlockStore.setState({ blocks: [] });
});

describe('capability block inputs', () => {
    it('shows a field per declared input and names what is missing instead of offering Run', () => {
        const instanceId = placeWeatherBlock();
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect(screen.getByLabelText(/^City/)).toBeTruthy();
        expect((screen.getByLabelText(/^State/) as HTMLSelectElement).tagName).toBe('SELECT');
        expect((screen.getByLabelText(/^Days/) as HTMLInputElement).type).toBe('number');
        const run = screen.getByRole('button', { name: 'Enter city, state' }) as HTMLButtonElement;
        expect(run.disabled).toBe(true);
    });

    it('runs with what you typed, as typed arguments, and keeps it on the block', async () => {
        const instanceId = placeWeatherBlock();
        render(<CapabilityBlockView instanceId={instanceId} />);
        fireEvent.change(screen.getByLabelText(/^City/), { target: { value: 'Seattle' } });
        fireEvent.change(screen.getByLabelText(/^State/), { target: { value: 'WA' } });
        fireEvent.change(screen.getByLabelText(/^Days/), { target: { value: '3' } });

        expect(useBlockStore.getState().getBlock(instanceId)?.params).toMatchObject({ city: 'Seattle', state: 'WA', days: '3' });
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));

        expect(await screen.findByText('Light rain')).toBeTruthy();
        const url = new URL(requests[0]);
        expect(url.searchParams.get('city')).toBe('Seattle');
        expect(url.searchParams.get('state')).toBe('WA');
        expect(url.searchParams.get('days')).toBe('3');
    });

    it('lays a record out as label and value rows, with the raw response one click away', async () => {
        const instanceId = placeWeatherBlock();
        useBlockStore.getState().setParams(instanceId, { city: 'Seattle', state: 'WA' });
        render(<CapabilityBlockView instanceId={instanceId} />);
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));

        expect(await screen.findByText('Temp f')).toBeTruthy();
        expect(screen.getByText('54')).toBeTruthy();
        expect(screen.getByText('1 field')).toBeTruthy(); // the nested Wind object, collapsed
        fireEvent.click(screen.getByRole('button', { name: 'Raw JSON' }));
        expect(screen.getByTestId('capability-raw').textContent).toContain('"TempF": 54');
    });

    it('falls back to a wired value when the field is emptied', () => {
        const instanceId = placeWeatherBlock();
        useBlockStore.getState().setParams(instanceId, { city: '' });
        const manifest = compileOpenApi(WEATHER_SPEC).manifests[0];
        expect(missingInputs(manifest.inputs, { city: '' }, { city: 'Boston', state: 'NY' })).toEqual([]);
        expect(argumentsFrom(manifest.inputs, { city: '', state: 'NY' })).toEqual({ state: 'NY' });
    });
});

describe('capability block layout', () => {
    it('folds the inputs away once a run answers, and shows what they were', async () => {
        const instanceId = placeWeatherBlock();
        useBlockStore.getState().setParams(instanceId, { city: 'Seattle', state: 'WA' });
        render(<CapabilityBlockView instanceId={instanceId} />);
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        await screen.findByText('Light rain');

        expect(screen.queryByLabelText(/^City/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Inputs: city Seattle · state WA/ }));
        expect(screen.getByLabelText(/^City/)).toBeTruthy();
    });

    it('puts an error first, and keeps the inputs open to fix it', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad license"}', { status: 403, headers: { 'content-type': 'application/json' } })));
        const instanceId = placeWeatherBlock();
        useBlockStore.getState().setParams(instanceId, { city: 'Seattle', state: 'WA' });
        render(<CapabilityBlockView instanceId={instanceId} />);
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/403/);
        expect(alert.textContent).toMatch(/Check the key/);
        expect(screen.getByLabelText(/^City/)).toBeTruthy();
    });

    it('masks an input that looks like a key, and says it is saved with the canvas', () => {
        const spec = structuredClone(WEATHER_SPEC);
        spec.paths['/getweather'].get.parameters.push({ name: 'license', in: 'query', required: true, schema: { type: 'string' } } as never);
        const manifest = compileOpenApi(spec).manifests[0];
        installProposal(manifest);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(manifest.id)!, { x: 0, y: 0 });
        render(<CapabilityBlockView instanceId={instanceId} />);
        expect((screen.getByLabelText(/^License/) as HTMLInputElement).type).toBe('password');
        expect(screen.getByText(/Looks like a key\. It is saved with this canvas/)).toBeTruthy();
        expect((screen.getByLabelText(/^City/) as HTMLInputElement).type).toBe('text');
    });

    it('is placed tall enough for its inputs', () => {
        const instanceId = placeWeatherBlock();
        const block = useBlockStore.getState().getBlock(instanceId)!;
        expect(block.dimensions.height).toBeGreaterThanOrEqual(220 + 3 * 52);
    });
});

describe('fields say what the spec says', () => {
    const city: CapabilityInput = { name: 'city', in: 'query', required: true, example: 'Seattle', schema: { kind: 'string', description: 'City for weather information' } };
    const units: CapabilityInput = { name: 'units', in: 'query', required: false, default: 'us', schema: { kind: 'string', enum: ['metric', 'us'] } };
    const days: CapabilityInput = { name: 'days', in: 'query', required: false, schema: { kind: 'integer', description: 'How many days ahead' } };

    it('shows the description under the field, linked to it, and the example as the placeholder', () => {
        render(<CapabilityInputs inputs={[city]} params={{}} wired={{}} onChange={() => {}} />);
        const field = screen.getByLabelText(/^City/) as HTMLInputElement;
        expect(field.placeholder).toBe('e.g. Seattle');
        const help = document.getElementById(field.getAttribute('aria-describedby')!)!;
        expect(help.textContent).toBe('City for weather information');
    });

    it('offers the default in a select instead of a bare "Choose"', () => {
        render(<CapabilityInputs inputs={[city, units]} params={{}} wired={{}} onChange={() => {}} />);
        expect(screen.getByRole('option', { name: 'Default (us)' })).toBeTruthy();
    });

    it('folds optional inputs away behind a count, and opens them once one has a value', () => {
        const { rerender } = render(<CapabilityInputs inputs={[city, units, days]} params={{}} wired={{}} onChange={() => {}} />);
        const fold = screen.getByText('Optional · 2').closest('details')!;
        expect(fold.open).toBe(false);
        rerender(<CapabilityInputs inputs={[city, units, days]} params={{ days: '3' }} wired={{}} onChange={() => {}} />);
        expect(screen.getByText('Optional · 2').closest('details')!.open).toBe(true);
    });

    it('does not fold when nothing is required', () => {
        render(<CapabilityInputs inputs={[units, days]} params={{}} wired={{}} onChange={() => {}} />);
        expect(screen.getByText('Optional · 2').closest('details')!.open).toBe(true);
    });
});

describe('a JSON body laid out as fields', () => {
    const body: CapabilityInput = {
        name: 'body', in: 'body', required: true,
        schema: {
            kind: 'object', required: ['text'],
            properties: {
                text: { kind: 'string', description: 'What to analyse' },
                language: { kind: 'string', enum: ['en', 'fr'] },
                limit: { kind: 'integer' }
            }
        }
    };

    it('gives each plain property a field, and keeps a nested body as one JSON box', () => {
        expect(bodyFields(body)?.map(field => `${field.name}${field.required ? '*' : ''}`)).toEqual(['text*', 'language', 'limit']);
        const nested: CapabilityInput = { ...body, schema: { kind: 'object', properties: { filter: { kind: 'object' } } } };
        expect(bodyFields(nested)).toBeNull();
    });

    it('stores a draft per property, and sends them as one typed object', () => {
        const onChange = vi.fn();
        render(<CapabilityInputs inputs={[body]} params={{ body: { text: 'hi' } }} wired={{}} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText(/^Limit/), { target: { value: '5' } });
        expect(onChange).toHaveBeenCalledWith('body', { text: 'hi', limit: '5' });
        expect(argumentsFrom([body], { body: { text: 'hi', limit: '5', language: '' } })).toEqual({ body: { text: 'hi', limit: 5 } });
    });

    it('names the missing properties, not "body"', () => {
        expect(missingInputs([body], {}, {}).map(input => input.name)).toEqual(['text']);
        expect(missingInputs([body], { body: { text: 'hi' } }, {})).toEqual([]);
        expect(missingInputs([{ ...body, required: false }], {}, {})).toEqual([]);
    });

    it('summarises the properties that were sent', () => {
        expect(inputSummaryOf([body], { body: { text: 'hi', limit: '5' } })).toBe('text hi · limit 5');
    });
});

describe('coerceInput', () => {
    const input = (kind: CapabilityInput['schema']['kind'], extra: Partial<CapabilityInput['schema']> = {}): CapabilityInput =>
        ({ name: 'x', in: 'query', required: false, schema: { kind, ...extra } });

    it('keeps an empty field empty', () => {
        expect(coerceInput(input('string'), '   ')).toBeUndefined();
        expect(coerceInput(input('number'), '')).toBeUndefined();
    });

    it('turns number text into a number, and leaves non-numbers for validation to name', () => {
        expect(coerceInput(input('integer'), '42')).toBe(42);
        expect(coerceInput(input('number'), '1.5')).toBe(1.5);
        expect(coerceInput(input('number'), 'abc')).toBe('abc');
    });

    it('matches an enum option back to its original type', () => {
        expect(coerceInput(input('integer', { enum: [1, 2, 3] }), '2')).toBe(2);
    });

    it('parses JSON for structured inputs', () => {
        expect(coerceInput(input('array'), '["a","b"]')).toEqual(['a', 'b']);
        expect(coerceInput(input('object'), '{bad')).toBe('{bad');
    });

    it('keeps a checkbox as a boolean, including false', () => {
        expect(coerceInput(input('boolean'), false)).toBe(false);
        expect(coerceInput(input('boolean'), true)).toBe(true);
    });
});

describe('an input with one allowed value', () => {
    const format: CapabilityInput = { name: 'file_type', in: 'query', required: true, schema: { kind: 'string', enum: ['json'] } };
    const series: CapabilityInput = { name: 'series_id', in: 'query', required: true, schema: { kind: 'string' } };

    it('is sent without a field, and never asked for', () => {
        render(<CapabilityInputs inputs={[format, series]} params={{}} wired={{}} onChange={() => {}} />);
        expect(screen.queryByLabelText(/^File type/)).toBeNull();
        expect(missingInputs([format, series], {}, {}).map(input => input.name)).toEqual(['series_id']);
        expect(argumentsFrom([format, series], { series_id: 'GDP' })).toEqual({ file_type: 'json', series_id: 'GDP' });
        expect(inputSummaryOf([format, series], { series_id: 'GDP' })).toBe('series_id GDP');
    });

    it('stays a choice when it is optional', () => {
        expect(argumentsFrom([{ ...format, required: false }], {})).toEqual({});
    });
});
