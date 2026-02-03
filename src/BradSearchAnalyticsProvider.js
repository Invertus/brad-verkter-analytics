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
 * - Cart enrichment (via cartId prop)
 */

import React, { useEffect, useRef } from 'react';
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
 * @param {string} [props.cartId] - Optional. Cart ID for cart enrichment
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
                console.log('[BradSearch Analytics] Tracker initialized successfully');
            }
        });

        return () => {
            mounted = false;
        };
    }, [enabled, websiteId, scriptUrl, debug]);

    // Update cart enrichment when cart ID changes
    useEffect(() => {
        if (trackerRef.current && cartId) {
            try {
                trackerRef.current.updateCart({
                    cartId: cartId
                });
            } catch (error) {
                console.error('[BradSearch Analytics] Error updating cart:', error);
            }
        }
    }, [cartId]);

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
