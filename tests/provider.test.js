import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, waitFor } from '@testing-library/react';

jest.mock('@bradsearch/analytics-core', () => ({
    createTracker: () => ({ initialize: () => Promise.resolve(), trackPageVisit: jest.fn() }),
    UmamiProvider: function UmamiProvider() {}
}));

import { BradSearchAnalyticsProvider } from '../src/BradSearchAnalyticsProvider';

describe('BradSearchAnalyticsProvider assistant events', () => {
    beforeEach(() => {
        window.umami = { track: jest.fn() };
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('forwards bradsearch-context once the tracker is ready, with the cartId on cart events', async () => {
        render(
            <MemoryRouter>
                <BradSearchAnalyticsProvider websiteId="w" cartId="cart-9">
                    <div />
                </BradSearchAnalyticsProvider>
            </MemoryRouter>
        );

        await waitFor(() => {
            document.dispatchEvent(new CustomEvent('bradsearch-context', {
                detail: { t: 'cart', items: [{ product_id: 1, qty: 1 }] }
            }));
            expect(window.umami.track).toHaveBeenCalledWith('cart', {
                items: [{ product_id: 1, qty: 1 }],
                cart_id: 'cart-9'
            });
        });
    });
});
