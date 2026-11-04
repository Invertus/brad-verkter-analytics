/**
 * BradSearch Analytics Provider
 *
 * Self-contained analytics tracking provider that handles ALL tracking automatically.
 * Uses DOM event listeners with data attributes to track user interactions with
 * minimal component modifications.
 *
 * Features:
 * - Autocomplete event tracking (custom DOM events)
 * - Search results page tracking: view-search via useBradSearchResultsPage, and
 *   search-product-click enrichment for clicks sent through useBradSearchTracker
 * - Page visit signal tracking for conversion attribution (via cartId prop)
 * - Assistant events: bradsearch-context (search, product view, cart, order) and assistant card
 *   clicks, with the A/B tag (see assistantEvents.js)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { createTracker, UmamiProvider } from '@bradsearch/analytics-core';
import { DEFAULT_SCRIPT_URL } from './config/constants';
import { registerAssistantEvents } from './assistantEvents';

// Module-level tracker reference shared across the provider
let globalTracker = null;

// Hooks waiting for the tracker (it initializes asynchronously after the first render)
const trackerListeners = new Set();

// The search results page on screen, set by useBradSearchResultsPage: its query and the
// bradsearch_search object of the Magento GraphQL products response
let currentResultsPage = null;

const setGlobalTracker = (tracker) => {
    globalTracker = tracker;
    trackerListeners.forEach(listener => listener(tracker));
};

const AI_MATCH_VALUES = ['exact', 'close', 'none'];
const CORRELATION_ID_KEY = 'X-Request-Correlation-ID';

/**
 * Pass the widget's request correlation id so analytics can join the event to the search request.
 * analytics-core sends `correlation.correlationId` as the X-Request-Correlation-ID header.
 */
const addCorrelationId = (trackingData, detail) => {
    if (detail && detail[CORRELATION_ID_KEY]) {
        trackingData.correlation = { correlationId: detail[CORRELATION_ID_KEY] };
    }
    return trackingData;
};

/**
 * Add ai_used / ai_match when the AI search path ran for the query (detail.aiSearch is set)
 */
const addAiSearchData = (trackingData, detail) => {
    const aiSearch = detail.aiSearch;
    if (aiSearch && aiSearch.used === true && AI_MATCH_VALUES.includes(aiSearch.match)) {
        trackingData.ai_used = true;
        trackingData.ai_match = aiSearch.match;
    }
    return trackingData;
};

/**
 * Add ai_match when the clicked product was served by AI search (detail.aiMatch is set)
 */
const addAiClickData = (trackingData, detail) => {
    if (detail.aiMatch === 'exact' || detail.aiMatch === 'close') {
        trackingData.ai_match = detail.aiMatch;
    }
    return trackingData;
};

/**
 * Shape a results page's bradsearch_search like the autocomplete event detail, so the
 * same helpers apply the same rules to the results page
 */
const resultsPageDetail = (bradsearchSearch, productId) => {
    const detail = {};
    if (!bradsearchSearch) {
        return detail;
    }

    detail.aiSearch = bradsearchSearch.ai_search;
    detail[CORRELATION_ID_KEY] = bradsearchSearch.correlation_id;

    if (productId !== undefined && Array.isArray(bradsearchSearch.ai_matches)) {
        const match = bradsearchSearch.ai_matches.find(item => item && Number(item.product_id) === Number(productId));
        detail.aiMatch = match ? match.ai_match : undefined;
    }

    return detail;
};

/**
 * Initialize the analytics tracker
 */
const initializeTracker = async (config) => {
    try {
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
                setGlobalTracker(tracker);
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
    const { pathname } = useLocation();

    const detectPageName = (path) => {
        if (path.startsWith('/success')) return 'order-confirmation';
        if (path.startsWith('/checkout')) return 'checkout';
        if (path.startsWith('/cart')) return 'cart';
        return null;
    };

    const trackPageVisit = useCallback((path) => {
        const pageName = detectPageName(path);
        if (!pageName) return;

        // Avoid duplicate signals for the same page + cartId
        const key = `${pageName}:${cartId}`;
        if (lastTrackedPageRef.current === key) return;
        lastTrackedPageRef.current = key;

        trackerRef.current.trackPageVisit({ pageName, cartId });
    }, [cartId]);

    useEffect(() => {
        if (!trackerReady || !cartId) return;
        trackPageVisit(pathname);
    }, [pathname, trackerReady, cartId, trackPageVisit]);

    // Forward the assistant's events (the Umami script is loaded once the tracker is ready)
    const cartIdRef = useRef(cartId);
    cartIdRef.current = cartId;

    useEffect(() => {
        if (!trackerReady) return;
        return registerAssistantEvents(() => cartIdRef.current);
    }, [trackerReady]);

    // Listen for BradSearch autocomplete events
    useEffect(() => {
        if (typeof document === 'undefined') return;

        const _handleAutocompleteClick = (detail) => {
            if (!trackerRef.current) return;

            if (detail.productIds) {
                _handleAutocompleteResponse(detail);
                return;
            }

            trackerRef.current.trackAutocompleteProductClick(addCorrelationId(addAiClickData({
                productId: parseInt(detail.product.id),
            }, detail), detail));
        };

        const _handleAutocompleteResponse = (detail) => {
            if (!trackerRef.current) return;
            const query = detail.query;
            const productIds = detail.productIds.map(function(id) {
                return parseInt(id);
            });

            trackerRef.current.trackAutocompleteResponse(addCorrelationId(addAiSearchData({
                query: query,
                product_ids: productIds
            }, detail), detail));
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
 * Wrap the tracker so trackSearchProductClick gets the search query from the URL (?query=)
 * and, on a results page tracked by useBradSearchResultsPage, the clicked product's ai_match
 * and the search's correlation id.
 */
const wrapTracker = (tracker) => {
    return new Proxy(tracker, {
        get(target, prop) {
            if (prop === 'trackSearchProductClick') {
                return (data) => {
                    let query = '';
                    try {
                        const params = new URLSearchParams(window.location.search);
                        query = params.get('query') || '';
                    } catch (e) { /* ignore */ }

                    const page = currentResultsPage;
                    const payload = { ...data, query: query || (page ? page.query : '') };
                    if (page) {
                        const detail = resultsPageDetail(page.bradsearchSearch, data && data.productId);
                        addCorrelationId(addAiClickData(payload, detail), detail);
                    }

                    return target.trackSearchProductClick(payload);
                };
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
};

/**
 * React hook to access the BradSearch tracker instance
 * @returns {object|null} The tracker instance or null if not initialized
 */
export const useBradSearchTracker = () => {
    return globalTracker ? wrapTracker(globalTracker) : null;
};

/**
 * Track the search results page: sends view-search once for each result set shown
 * (new query, page, sort or filter), with the product ids, ai_used / ai_match and the
 * search's correlation id; product clicks sent through useBradSearchTracker then carry
 * the clicked product's ai_match and the same correlation id.
 *
 * @param {Object} params
 * @param {string} params.query - The search term on screen
 * @param {Object} [params.products] - The `products` object of the ProductSearch GraphQL
 *   response: `items` (with `id`) and `bradsearch_search`
 * @param {boolean} [params.loading] - true while the next result set is loading
 */
export const useBradSearchResultsPage = ({ query, products, loading = false }) => {
    const [tracker, setTracker] = useState(globalTracker);

    useEffect(() => {
        setTracker(globalTracker);
        trackerListeners.add(setTracker);
        return () => {
            trackerListeners.delete(setTracker);
        };
    }, []);

    const shown = !loading && products && Array.isArray(products.items) ? products : null;
    const bradsearchSearch = shown ? shown.bradsearch_search || null : null;
    const productIds = shown
        ? shown.items.map(item => parseInt(item && item.id)).filter(id => !isNaN(id))
        : [];
    const resultKey = shown
        ? [query, bradsearchSearch ? bradsearchSearch.correlation_id : '', productIds.join(',')].join('|')
        : null;

    // Make the shown results available to search-product-click (see wrapTracker)
    useEffect(() => {
        if (!shown) return;
        const page = { query, bradsearchSearch };
        currentResultsPage = page;
        return () => {
            if (currentResultsPage === page) {
                currentResultsPage = null;
            }
        };
    }, [resultKey]);

    const lastSentKeyRef = useRef(null);
    useEffect(() => {
        if (!tracker || !resultKey || lastSentKeyRef.current === resultKey) return;
        lastSentKeyRef.current = resultKey;

        const detail = resultsPageDetail(bradsearchSearch);
        tracker.trackViewSearch(addCorrelationId(addAiSearchData({
            query: query,
            product_ids: productIds
        }, detail), detail));
    }, [tracker, resultKey]);
};
