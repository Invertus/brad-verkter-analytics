/**
 * BradSearch Analytics Provider
 *
 * Self-contained analytics tracking provider that handles ALL tracking automatically.
 * Uses DOM event listeners with data attributes to track user interactions with
 * minimal component modifications.
 *
 * Features:
 * - Autocomplete event tracking (custom DOM events)
 * - Search product click tracking (event delegation with data attributes)
 * - Page visit signal tracking for conversion attribution (via cartId prop)
 */

import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_SCRIPT_URL } from './config/constants';

// Module-level tracker reference shared across the provider
let globalTracker = null;

/**
 * Initialize the analytics tracker
 * Uses dynamic import to load @bradsearch/analytics-core only when needed
 */
const initializeTracker = async (config) => {
    try {
        // Dynamically import analytics-core only when enabled
        const { createTracker, UmamiProvider } = await import('@bradsearch/analytics-core');

        const tracker = createTracker({
            provider: new UmamiProvider({
                debug: config.debug,
                scriptConfig: {
                    scriptUrl: config.scriptUrl,
                    websiteId: config.websiteId,
                    doNotTrack: true,
                    autoTrack: false
                }
            }),
            debug: config.debug
        });

        await tracker.initialize();

        return tracker;
    } catch (error) {
        console.error('[BradSearch Analytics] Failed to initialize tracker:', error);
        return null;
    }
};

/**
 * BradSearch Analytics Provider Component
 *
 * Wraps the application and sets up all tracking listeners.
 * All tracking happens automatically without component modifications.
 *
 * @param {Object} props
 * @param {string} props.websiteId - Required. Umami website ID (UUID)
 * @param {string} [props.scriptUrl] - Optional. Umami script URL. Defaults to DEFAULT_SCRIPT_URL
 * @param {boolean} [props.enabled=true] - Optional. Enable/disable tracking
 * @param {boolean} [props.debug] - Optional. Enable debug logging. Defaults to NODE_ENV === 'development'
 * @param {string} [props.cartId] - Optional. Cart ID for page visit signal tracking
 * @param {React.ReactNode} props.children - App content
 */
export const BradSearchAnalyticsProvider = ({
    websiteId,
    scriptUrl = DEFAULT_SCRIPT_URL,
    enabled = true,
    debug = process.env.NODE_ENV === 'development',
    cartId,
    children
}) => {
    const trackerRef = useRef(null);
    const [trackerReady, setTrackerReady] = useState(false);

    // Initialize tracker when config is available
    useEffect(() => {
        if (!enabled) {
            return;
        }

        if (!websiteId) {
            console.warn('[BradSearch Analytics] Missing websiteId. Analytics will not be initialized.');
            return;
        }

        let mounted = true;

        const config = {
            websiteId,
            scriptUrl,
            debug
        };

        initializeTracker(config).then(tracker => {
            if (tracker && mounted) {
                trackerRef.current = tracker;
                globalTracker = tracker;
                setTrackerReady(true);
                console.log('[BradSearch Analytics] Tracker initialized successfully');
            }
        });

        return () => {
            mounted = false;
        };
    }, [enabled, websiteId, scriptUrl, debug]);

    // Track page visit signals for conversion attribution
    // Fires when cartId is available and user is on a significant page (cart, checkout, success)
    const lastTrackedPageRef = useRef(null);

    useEffect(() => {
        if (!trackerReady || !cartId) return;
        if (typeof window === 'undefined') return;

        const detectPageName = (path) => {
            if (path.startsWith('/success')) return 'order-confirmation';
            if (path.startsWith('/checkout')) return 'checkout';
            if (path.startsWith('/cart')) return 'cart';
            return null;
        };

        const trackPageVisit = () => {
            const pageName = detectPageName(window.location.pathname);
            if (!pageName) return;

            // Avoid duplicate signals for the same page + cartId
            const key = `${pageName}:${cartId}`;
            if (lastTrackedPageRef.current === key) return;
            lastTrackedPageRef.current = key;

            trackerRef.current.trackPageVisit({ pageName, cartId });
        };

        trackPageVisit();

        // Track on SPA route changes
        const origPushState = history.pushState;
        const origReplaceState = history.replaceState;

        history.pushState = function(...args) {
            origPushState.apply(this, args);
            setTimeout(trackPageVisit, 0);
        };
        history.replaceState = function(...args) {
            origReplaceState.apply(this, args);
            setTimeout(trackPageVisit, 0);
        };
        window.addEventListener('popstate', trackPageVisit);

        return () => {
            history.pushState = origPushState;
            history.replaceState = origReplaceState;
            window.removeEventListener('popstate', trackPageVisit);
        };
    }, [trackerReady, cartId]);

    // Listen for BradSearch autocomplete events
    useEffect(() => {
        if (typeof document === 'undefined') return;

        const _handleAutocompleteClick = (detail) => {
            if (!trackerRef.current) return;

            if (detail.productIds) {
                _handleAutocompleteResponse(detail);
                return;
            }

            trackerRef.current.trackAutocompleteProductClick({
                productId: parseInt(detail.product.id),
            });
        };

        const _handleAutocompleteResponse = (detail) => {
            if (!trackerRef.current) return;
            const query = detail.query;
            const productIds = detail.productIds.map(function(id) {
                return parseInt(id);
            });

            trackerRef.current.trackAutocompleteResponse({
                query: query,
                product_ids: productIds
            });
        };

        /**
         * Handle autocomplete product/category/facet clicks
         */
        const handleAutocompleteClick = (event) => {
            // Check if event.detail is an array
            if (Array.isArray(event.detail)) {
                // Iterate over array and execute function for each item asynchronously
                event.detail.forEach(function(detail) {
                    _handleAutocompleteClick(detail);
                });
            } else {
                _handleAutocompleteClick(event.detail);
            }
        };

        /**
         * Handle autocomplete response (when results are shown)
         */
        const handleAutocompleteResponse = (event) => {
            if (!trackerRef.current) return;

            // Check if event.detail is an array
            if (Array.isArray(event.detail)) {
                // Iterate over array and execute function for each item asynchronously
                event.detail.forEach(function(detail) {
                    _handleAutocompleteResponse(detail);
                });
            } else {
                // Execute function directly for single object
                _handleAutocompleteResponse(event.detail);
            }
        };

        // Add event listeners
        document.addEventListener('bradsearch-autocomplete-product-click', handleAutocompleteClick);
        document.addEventListener('bradsearch-autocomplete-success', handleAutocompleteResponse);

        // Cleanup
        return () => {
            document.removeEventListener('bradsearch-autocomplete-product-click', handleAutocompleteClick);
            document.removeEventListener('bradsearch-autocomplete-success', handleAutocompleteResponse);
        };
    }, []);

    // Render children without wrapping (no context needed)
    return <>{children}</>;
};

/**
 * React hook to access the BradSearch tracker instance
 * @returns {object|null} The tracker instance or null if not initialized
 */
export const useBradSearchTracker = () => {
    return globalTracker;
};
