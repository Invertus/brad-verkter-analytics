import { TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import {
    getAbTag,
    normalizeItems,
    registerAssistantEvents,
    dispatchSearchCommitted,
    dispatchProductView,
    dispatchOrder
} from '../src/assistantEvents';

global.TextEncoder = TextEncoder;
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });

const context = (detail) => document.dispatchEvent(new CustomEvent('bradsearch-context', { detail }));

let track;
let unregister;

beforeEach(() => {
    track = jest.fn();
    window.umami = { track };
    delete window.bradsearchAbTag;
    window.localStorage.clear();
    window.sessionStorage.clear();
    unregister = registerAssistantEvents(() => 'cart-1');
});

afterEach(() => {
    unregister();
});

describe('forwarding bradsearch-context', () => {
    it('sends search-committed', () => {
        context({ t: 'search', query: 'gloves', total: 12, c: 1 });
        expect(track).toHaveBeenCalledWith('search-committed', { query: 'gloves', total: 12, c: 1 });
    });

    it('ignores a search without a query', () => {
        context({ t: 'search', total: 3 });
        expect(track).not.toHaveBeenCalled();
    });

    it('sends product-view with a numeric product_id, src and qid', () => {
        context({ t: 'product_view', product_id: '42', src: 'assistant', qid: 'c-1' });
        expect(track).toHaveBeenCalledWith('product-view', { product_id: 42, src: 'assistant', qid: 'c-1' });
    });

    it('drops a product-view with a non-numeric product_id', () => {
        context({ t: 'product_view', product_id: 'abc' });
        expect(track).not.toHaveBeenCalled();
    });

    it('sends cart with normalized items and the provider cart id', () => {
        context({ t: 'cart', items: [{ product_id: '5', variant_id: '9', qty: 2 }, { product_id: 'x', qty: 1 }] });
        expect(track).toHaveBeenCalledWith('cart', {
            items: [{ product_id: 5, variant_id: 9, qty: 2 }],
            cart_id: 'cart-1'
        });
    });

    it('prefers the cart_id of the event and sends an empty cart', () => {
        context({ t: 'cart', items: [], cart_id: 'other' });
        expect(track).toHaveBeenCalledWith('cart', { items: [], cart_id: 'other' });
    });

    it('sends order', () => {
        context({ t: 'order', order_ref_hash: 'abc', items: [{ product_id: 1, qty: 1 }], total: 19.9, currency: 'EUR' });
        expect(track).toHaveBeenCalledWith('order', {
            order_ref_hash: 'abc',
            items: [{ product_id: 1, qty: 1 }],
            total: 19.9,
            currency: 'EUR'
        });
    });

    it('handles an array of details', () => {
        context([{ t: 'search', query: 'a', total: 1 }, { t: 'search', query: 'b', total: 2 }]);
        expect(track).toHaveBeenCalledTimes(2);
    });

    it('ignores unknown types', () => {
        context({ t: 'something' });
        expect(track).not.toHaveBeenCalled();
    });

    it('stops listening after unregister', () => {
        unregister();
        context({ t: 'search', query: 'gloves', total: 1 });
        expect(track).not.toHaveBeenCalled();
    });
});

describe('assistant card click', () => {
    it('sends assistant-card-click with the conversation id as qid', () => {
        document.dispatchEvent(new CustomEvent('bradsearch-assistant-card-click', {
            detail: { conversationId: 'conv-7', productId: '77', url: '/p', position: 1 }
        }));
        expect(track).toHaveBeenCalledWith('assistant-card-click', { product_id: 77, action: 'click', qid: 'conv-7' });
    });

    it('ignores a click without a numeric product id', () => {
        document.dispatchEvent(new CustomEvent('bradsearch-assistant-card-click', { detail: { productId: 'x' } }));
        expect(track).not.toHaveBeenCalled();
    });
});

describe('A/B tag', () => {
    it('uses the plain umami call without a tag', () => {
        context({ t: 'search', query: 'q', total: 1 });
        expect(track.mock.calls[0][0]).toBe('search-committed');
    });

    it('adds the tag to the event payload through umami.track(fn)', () => {
        window.bradsearchAbTag = 'test:b';
        context({ t: 'search', query: 'q', total: 1 });

        const fn = track.mock.calls[0][0];
        expect(typeof fn).toBe('function');
        expect(fn({ website: 'w', url: '/x' })).toEqual({
            website: 'w',
            url: '/x',
            name: 'search-committed',
            data: { query: 'q', total: 1, c: 1 },
            tag: 'test:b'
        });
    });

    it('reads the stored tag while it is valid', () => {
        window.localStorage.setItem('bradsearch:abtag', JSON.stringify({ tag: 'old:a', until: Date.now() + 1000 }));
        expect(getAbTag()).toBe('old:a');

        window.localStorage.setItem('bradsearch:abtag', JSON.stringify({ tag: 'old:a', until: Date.now() - 1 }));
        expect(getAbTag()).toBeNull();
    });

    it('rejects a tag longer than 50 characters', () => {
        window.bradsearchAbTag = 'x'.repeat(51);
        expect(getAbTag()).toBeNull();
    });

    it('does nothing without the umami script', () => {
        delete window.umami;
        expect(() => context({ t: 'search', query: 'q', total: 1 })).not.toThrow();
    });
});

describe('normalizeItems', () => {
    it('reads Venia cart items', () => {
        expect(normalizeItems([
            { product: { id: 10 }, configured_variant: { id: 11 }, quantity: 3 },
            { product: { id: '12' }, quantity: 1 }
        ])).toEqual([
            { product_id: 10, variant_id: 11, qty: 3 },
            { product_id: 12, qty: 1 }
        ]);
    });

    it('counts a missing quantity as 1 and tolerates non-arrays', () => {
        expect(normalizeItems([{ product_id: 1 }])).toEqual([{ product_id: 1, qty: 1 }]);
        expect(normalizeItems(undefined)).toEqual([]);
    });
});

describe('dispatch helpers', () => {
    let seen;
    let listener;

    beforeEach(() => {
        seen = [];
        listener = (event) => seen.push(event.detail);
        document.addEventListener('bradsearch-context', listener);
    });

    afterEach(() => {
        document.removeEventListener('bradsearch-context', listener);
    });

    it('dispatchSearchCommitted emits t:search with c:1', () => {
        dispatchSearchCommitted('drill', 8);
        expect(seen).toEqual([{ t: 'search', query: 'drill', c: 1, total: 8 }]);
    });

    it('dispatchSearchCommitted skips an empty query', () => {
        dispatchSearchCommitted('', 8);
        expect(seen).toEqual([]);
    });

    describe('dispatchProductView', () => {
        const setMarker = (marker) => window.sessionStorage.setItem('bradsearch:last_src', JSON.stringify(marker));

        it('without a marker sends the product only', () => {
            dispatchProductView(5);
            expect(seen).toEqual([{ t: 'product_view', product_id: 5 }]);
        });

        it('reads and clears a matching marker', () => {
            setMarker({ src: 'assistant', qid: 'c-1', product_id: 5, ts: Date.now() });
            dispatchProductView('5');
            expect(seen).toEqual([{ t: 'product_view', product_id: 5, src: 'assistant', qid: 'c-1' }]);
            expect(window.sessionStorage.getItem('bradsearch:last_src')).toBeNull();
        });

        it('keeps a marker for another product', () => {
            setMarker({ src: 'search', product_id: 6, ts: Date.now() });
            dispatchProductView(5);
            expect(seen).toEqual([{ t: 'product_view', product_id: 5 }]);
            expect(window.sessionStorage.getItem('bradsearch:last_src')).not.toBeNull();
        });

        it('ignores and clears a marker older than 10 minutes', () => {
            setMarker({ src: 'search', product_id: 5, ts: Date.now() - 11 * 60 * 1000 });
            dispatchProductView(5);
            expect(seen).toEqual([{ t: 'product_view', product_id: 5 }]);
            expect(window.sessionStorage.getItem('bradsearch:last_src')).toBeNull();
        });

        it('skips a non-numeric product id', () => {
            dispatchProductView('abc');
            expect(seen).toEqual([]);
        });
    });

    describe('dispatchOrder', () => {
        const order = {
            identifier: 'order-123',
            items: [{ product: { id: 3 }, quantity: 2 }],
            total: 50,
            currency: 'EUR'
        };

        it('hashes the identifier with sha256 and de-duplicates for 7 days', async () => {
            expect(await dispatchOrder(order)).toBe(true);
            expect(seen).toHaveLength(1);
            expect(seen[0]).toEqual({
                t: 'order',
                order_ref_hash: '3b6a198e6f182f27b91aa5a8b37ab70d4c54d3889e4a947243c1afd3e718ca66',
                items: [{ product_id: 3, qty: 2 }],
                total: 50,
                currency: 'EUR'
            });

            expect(await dispatchOrder(order)).toBe(false);
            expect(seen).toHaveLength(1);
        });

        it('sends again after the 7 day window', async () => {
            await dispatchOrder(order);
            const key = Object.keys(window.localStorage).find(k => k.startsWith('bradsearch:order:'));
            window.localStorage.setItem(key, String(Date.now() - 8 * 24 * 60 * 60 * 1000));
            expect(await dispatchOrder(order)).toBe(true);
            expect(seen).toHaveLength(2);
        });

        it('skips an order without an identifier', async () => {
            expect(await dispatchOrder({ ...order, identifier: '' })).toBe(false);
            expect(seen).toEqual([]);
        });
    });
});
