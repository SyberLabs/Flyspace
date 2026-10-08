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
        expect(listInside({ items: [1], meta: { nested: true } })).toBeNull(); // nested metadata stays a record
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
        expect(tableOf([{ a: 1, b: { c: 2 } }])).toBeNull();
        expect(tableOf([Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]))])).toBeNull();
        expect(tableOf([1, 2, 3])).toBeNull();
    });

    it('keeps every column of a single row, since nothing repeats', () => {
        expect(tableOf([{ date: '2026-09-01', value: '4.1' }])).toEqual({ columns: ['date', 'value'], fixed: [] });
    });
});
