import React from 'react';
import { render } from '@testing-library/react';
import { useBradSearchCartSnapshot, resetCartSnapshotState } from '../src/useBradSearchCartSnapshot';

const Probe = (props) => {
    useBradSearchCartSnapshot(props);
    return null;
};

const item = (id, quantity, variant) => ({
    product: { id },
    ...(variant ? { configured_variant: { id: variant } } : {}),
    quantity
});

let seen;
const listener = (event) => seen.push(event.detail);

beforeEach(() => {
    jest.useFakeTimers();
    seen = [];
    window.sessionStorage.clear();
    resetCartSnapshotState();
    document.addEventListener('bradsearch-context', listener);
});

afterEach(() => {
    document.removeEventListener('bradsearch-context', listener);
    jest.useRealTimers();
});

const flush = () => jest.advanceTimersByTime(300);

describe('useBradSearchCartSnapshot', () => {
    it('dispatches a cart snapshot after 300 ms', () => {
        render(<Probe items={[item(1, 2, 11)]} cartId="c1" />);
        expect(seen).toEqual([]);

        flush();
        expect(seen).toEqual([{ t: 'cart', items: [{ product_id: 1, variant_id: 11, qty: 2 }], cart_id: 'c1' }]);
    });

    it('debounces quick changes into one snapshot', () => {
        const { rerender } = render(<Probe items={[item(1, 1)]} cartId="c1" />);
        jest.advanceTimersByTime(100);
        rerender(<Probe items={[item(1, 2)]} cartId="c1" />);
        jest.advanceTimersByTime(100);
        rerender(<Probe items={[item(1, 3)]} cartId="c1" />);
        flush();

        expect(seen).toHaveLength(1);
        expect(seen[0].items).toEqual([{ product_id: 1, qty: 3 }]);
    });

    it('does not repeat an identical cart (new array, same content, other order)', () => {
        const { rerender } = render(<Probe items={[item(1, 1), item(2, 1)]} cartId="c1" />);
        flush();
        rerender(<Probe items={[item(2, 1), item(1, 1)]} cartId="c1" />);
        flush();

        expect(seen).toHaveLength(1);
    });

    it('treats an emptied cart as a snapshot', () => {
        const { rerender } = render(<Probe items={[item(1, 1)]} cartId="c1" />);
        flush();
        rerender(<Probe items={[]} cartId="c1" />);
        flush();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toEqual({ t: 'cart', items: [], cart_id: 'c1' });
    });

    it('sends nothing for a cart that is empty from the start, nor while it is loading', () => {
        const { rerender } = render(<Probe items={undefined} cartId="c1" />);
        flush();
        rerender(<Probe items={[]} cartId="c1" />);
        flush();

        expect(seen).toEqual([]);
    });

    it('sends the first fill after an empty start', () => {
        const { rerender } = render(<Probe items={[]} cartId="c1" />);
        flush();
        rerender(<Probe items={[item(4, 1)]} cartId="c1" />);
        flush();

        expect(seen).toHaveLength(1);
    });

    it('does not repeat the snapshot of a previous page load (signature in sessionStorage)', () => {
        const first = render(<Probe items={[item(1, 1)]} cartId="c1" />);
        flush();
        first.unmount();
        resetCartSnapshotState();

        render(<Probe items={[item(1, 1)]} cartId="c1" />);
        flush();

        expect(seen).toHaveLength(1);
    });
});
