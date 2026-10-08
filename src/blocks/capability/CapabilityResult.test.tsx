// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CapabilityResult, listInside, tableOf } from './CapabilityResult';

// FRED's series/observations, trimmed: paging metadata around one list of
// small flat records whose realtime columns repeat on every row.
const OBSERVATIONS = {
    realtime_start: '2026-10-07',
    realtime_end: '2026-10-07',
    units: 'lin',
    count: 3,
    observations: [
        { realtime_start: '2026-10-07', realtime_end: '2026-10-07', date: '2026-07-01', value: '4.3' },
        { realtime_start: '2026-10-07', realtime_end: '2026-10-07', date: '2026-08-01', value: '4.2' },
        { realtime_start: '2026-10-07', realtime_end: '2026-10-07', date: '2026-09-01', value: '4.1' }
    ]
};

describe('a response that wraps one list', () => {
    it('finds the list and keeps the rest as details', () => {
        const inside = listInside(OBSERVATIONS)!;
        expect(inside.key).toBe('observations');
        expect(Object.keys(inside.rest)).toEqual(['realtime_start', 'realtime_end', 'units', 'count']);
        expect(listInside({ a: [1], b: [2] })).toBeNull(); // two lists: no single answer
        expect(listInside({ items: [1], meta: { page: { n: 2 } } })).toBeNull(); // deeper metadata: not one answer
        expect(listInside({ items: [1], meta: { page: 2 } })?.rest).toEqual({ meta: { page: 2 } }); // flat metadata rides along
    });

    it('shows the list as a table, says repeated columns once, and folds the metadata', () => {
        render(<CapabilityResult value={OBSERVATIONS} />);
        const table = screen.getByRole('table');
        expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Date', 'Value']);
        expect(within(table).getAllByRole('row')).toHaveLength(4);
        expect(screen.getByText(/3 results/).textContent).toContain('Realtime start 2026-10-07');
        fireEvent.click(screen.getByText('About this response · 4 fields'));
        expect(screen.getByText('Units')).toBeTruthy();
    });
});

describe('tableOf', () => {
    it('refuses records that nest, and lists too wide to read', () => {
        expect(tableOf([{ a: 1, b: { c: 2 }, d: { e: 3 } }])).toBeNull(); // mostly nested
        expect(tableOf([Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, i]))])).toBeNull(); // too wide to read
        expect(tableOf([1, 2, 3])).toBeNull();
    });

    it('leaves out a column empty in every row (BLS footnotes: [{}])', () => {
        const rows = [
            { year: '2026', period: 'M09', value: '4.2', footnotes: [{}] },
            { year: '2026', period: 'M08', value: '4.1', footnotes: [{}] }
        ];
        expect(tableOf(rows)).toEqual({ columns: ['period', 'value'], fixed: [['year', '2026']] });
    });

    it('keeps every column of a single row, since nothing repeats', () => {
        expect(tableOf([{ date: '2026-09-01', value: '4.1' }])).toEqual({ columns: ['date', 'value'], fixed: [] });
    });
});

// Shapes from the curated APIs, as they answered on 2026-10-07.
describe('lists found deeper in a response', () => {
    it('reads BLS: the rows under Results.series[0].data, with the series id kept', () => {
        const bls = {
            status: 'REQUEST_SUCCEEDED', responseTime: 105, message: [],
            Results: { series: [{ seriesID: 'LNS14000000', data: [
                { year: '2026', period: 'M09', periodName: 'September', latest: 'true', value: '4.2' },
                { year: '2026', period: 'M08', periodName: 'August', value: '4.1' }
            ] }] }
        };
        const inside = listInside(bls)!;
        expect(inside.key).toBe('data');
        expect(inside.list).toHaveLength(2);
        expect(inside.rest).toMatchObject({ status: 'REQUEST_SUCCEEDED', seriesID: 'LNS14000000' });
    });

    it('reads Alpha Vantage price history: a map keyed by date becomes rows with a date column', () => {
        const history = {
            'Meta Data': { '1. Information': 'Daily Prices', '2. Symbol': 'IBM' },
            'Time Series (Daily)': {
                '2026-10-07': { '1. open': '221.90', '4. close': '220.51' },
                '2026-10-06': { '1. open': '219.10', '4. close': '221.29' }
            }
        };
        render(<CapabilityResult value={history} />);
        const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map(h => h.textContent);
        expect(headers).toEqual(['Date', '1. open', '4. close']);
        expect(screen.getByText('2026-10-07')).toBeTruthy();
    });

    it('reads an Alpha Vantage quote: one record in a one-key wrapper shows its fields', () => {
        render(<CapabilityResult value={{ 'Global Quote': { '01. symbol': 'IBM', '05. price': '220.5100' } }} />);
        expect(screen.getByText('Global quote')).toBeTruthy();
        expect(screen.getByText('220.5100')).toBeTruthy();
    });
});
