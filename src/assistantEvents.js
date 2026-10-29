/**
 * Assistant events
 *
 * The AI shopping assistant widget and the storefront talk through DOM events. This module:
 * - forwards them to analytics: `bradsearch-context` (search / product_view / cart / order) and
 *   `bradsearch-assistant-card-click`, with the A/B tag on every event
 * - exports the helpers the PWA calls to dispatch `bradsearch-context` events
 *
 * Event names and payloads match the WooCommerce tracker (views/js/tracker.js).
 */

const CONTEXT_EVENT = 'bradsearch-context';
const CARD_CLICK_EVENT = 'bradsearch-assistant-card-click';
const MARKER_KEY = 'bradsearch:last_src';
const MARKER_MAX_AGE_MS = 10 * 60 * 1000;
const AB_TAG_KEY = 'bradsearch:abtag';
const ORDER_SENT_PREFIX = 'bradsearch:order:';
const ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hasWindow = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const toId = (value) => {
    const id = parseInt(value, 10);
    return isNaN(id) ? null : id;
};

/**
 * The widget sets window.bradsearchAbTag ("<test>:<variant>") while an assistant test runs.
 * Pages without the widget use the tag it remembered ({tag, until} in localStorage).
 */
export const getAbTag = () => {
    if (!hasWindow()) return null;

    let tag = window.bradsearchAbTag;

    if (!tag) {
        try {
            const stored = JSON.parse(window.localStorage.getItem(AB_TAG_KEY));
            if (stored && typeof stored.until === 'number' && stored.until > Date.now()) {
                tag = stored.tag;
            }
        } catch (e) { /* storage blocked or invalid JSON */ }
    }

    if (typeof tag !== 'string' || tag === '' || tag.length > 50) {
        return null;
    }

    return tag;
};

/**
 * Send an event through the Umami script. analytics-core 1.2.0 cannot add a `tag`, so with an
 * A/B tag the event is built in the callback form of umami.track, which takes the full payload.
 */
export const trackWithTag = (name, data) => {
    if (!hasWindow() || !window.umami || typeof window.umami.track !== 'function') return;

    const tag = getAbTag();
    if (!tag) {
        window.umami.track(name, data);
        return;
    }

    window.umami.track((props) => ({ ...props, name, data, tag }));
};

/**
 * Cart/order items as [{product_id, variant_id?, qty}]. Accepts that shape or the PWA's
 * (Venia cart item: product.id, configured_variant.id, quantity). Rows without a numeric
 * product id are dropped; a missing quantity counts as 1.
 */
export const normalizeItems = (items) => {
    if (!Array.isArray(items)) return [];

    const result = [];
    items.forEach((item) => {
        if (!item) return;

        const productId = toId(item.product_id !== undefined ? item.product_id : item.product && item.product.id);
        if (productId === null) return;

        const rawVariant = item.variant_id !== undefined
            ? item.variant_id
            : item.configured_variant && item.configured_variant.id;
        const variantId = toId(rawVariant);
        const qty = toId(item.qty !== undefined ? item.qty : item.quantity);

        const row = { product_id: productId };
        if (variantId !== null) row.variant_id = variantId;
        row.qty = qty !== null && qty > 0 ? qty : 1;
        result.push(row);
    });

    return result;
};

/**
 * Forward one `bradsearch-context` detail to analytics
 */
const handleContext = (detail, getCartId) => {
    if (!detail) return;

    if (detail.t === 'search' && detail.query) {
        trackWithTag('search-committed', { query: detail.query, total: detail.total, c: 1 });
    } else if (detail.t === 'product_view' && toId(detail.product_id) !== null) {
        trackWithTag('product-view', {
            product_id: toId(detail.product_id),
            src: detail.src,
            qid: detail.qid
        });
    } else if (detail.t === 'cart' && Array.isArray(detail.items)) {
        const data = { items: normalizeItems(detail.items) };
        const cartId = detail.cart_id || (getCartId && getCartId());
        if (cartId) data.cart_id = cartId;
        trackWithTag('cart', data);
    } else if (detail.t === 'order' && detail.order_ref_hash && Array.isArray(detail.items)) {
        trackWithTag('order', {
            order_ref_hash: detail.order_ref_hash,
            items: normalizeItems(detail.items),
            total: detail.total,
            currency: detail.currency
        });
    }
};

const forEachDetail = (event, handler) => {
    if (Array.isArray(event.detail)) {
        event.detail.forEach(handler);
    } else {
        handler(event.detail);
    }
};

/**
 * Listen for the assistant's page events and send them to analytics.
 * The widget has no analytics client: its card clicks are forwarded here.
 *
 * @param {Function} [getCartId] - Returns the current cart id, added to `cart` events without one
 * @returns {Function} Removes the listeners
 */
export const registerAssistantEvents = (getCartId) => {
    if (!hasWindow()) return () => {};

    const onContext = (event) => forEachDetail(event, (detail) => handleContext(detail, getCartId));

    const onCardClick = (event) => {
        const detail = event.detail;
        if (!detail || toId(detail.productId) === null) return;

        trackWithTag('assistant-card-click', {
            product_id: toId(detail.productId),
            action: 'click',
            qid: detail.conversationId
        });
    };

    document.addEventListener(CONTEXT_EVENT, onContext);
    document.addEventListener(CARD_CLICK_EVENT, onCardClick);

    return () => {
        document.removeEventListener(CONTEXT_EVENT, onContext);
        document.removeEventListener(CARD_CLICK_EVENT, onCardClick);
    };
};

const emit = (detail) => {
    if (!hasWindow()) return;
    document.dispatchEvent(new CustomEvent(CONTEXT_EVENT, { detail }));
};

/**
 * Dispatch the cart snapshot (also feeds the widget's session context)
 */
export const dispatchCart = (items, cartId) => {
    const detail = { t: 'cart', items: normalizeItems(items) };
    if (cartId) detail.cart_id = cartId;
    emit(detail);
};

/**
 * A new query's results are on screen (not a page, sort or filter change)
 */
export const dispatchSearchCommitted = (query, total) => {
    if (!query) return;

    const detail = { t: 'search', query, c: 1 };
    if (typeof total === 'number') detail.total = total;
    emit(detail);
};

/**
 * The widget sets {src, qid, product_id, ts} when a results product or an assistant card is
 * opened. The product page reads it once: matching product, under 10 minutes old.
 */
const takeMarker = (productId) => {
    let marker;
    try {
        marker = JSON.parse(window.sessionStorage.getItem(MARKER_KEY));
    } catch (e) {
        return null;
    }

    if (!marker || (marker.src !== 'search' && marker.src !== 'assistant')) return null;

    if (typeof marker.ts !== 'number' || Date.now() - marker.ts > MARKER_MAX_AGE_MS) {
        try { window.sessionStorage.removeItem(MARKER_KEY); } catch (e) { /* ignore */ }
        return null;
    }

    if (marker.product_id && String(marker.product_id) !== String(productId)) return null;

    try { window.sessionStorage.removeItem(MARKER_KEY); } catch (e) { /* ignore */ }
    return marker;
};

/**
 * A product page was shown: carries src/qid when the shopper came from search or the assistant
 */
export const dispatchProductView = (productId) => {
    if (!hasWindow() || toId(productId) === null) return;

    const detail = { t: 'product_view', product_id: toId(productId) };
    const marker = takeMarker(productId);
    if (marker) {
        detail.src = marker.src;
        if (marker.qid) detail.qid = marker.qid;
    }
    emit(detail);
};

const sha256Hex = async (text) => {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Orders are de-duplicated across tabs and sessions (localStorage, one key per order, 7 days):
 * a reload of the success page is not a second order.
 */
const orderAlreadySent = (hash) => {
    const key = ORDER_SENT_PREFIX + hash;
    try {
        const sentAt = parseInt(window.localStorage.getItem(key), 10);
        if (sentAt > 0 && Date.now() - sentAt < ORDER_TTL_MS) return true;
        window.localStorage.setItem(key, String(Date.now()));
    } catch (e) { /* storage blocked: send, only the de-duplication is lost */ }
    return false;
};

/**
 * The order was placed (success page). Nothing about the customer is sent: the order is
 * identified by a hash of `identifier` (the order number or cart hash on the success URL).
 *
 * @param {Object} order
 * @param {string} order.identifier
 * @param {Array} order.items - [{product_id, variant_id?, qty}] or Venia items (product.id, quantity)
 * @param {number} order.total
 * @param {string} order.currency
 * @returns {Promise<boolean>} true when the event was dispatched
 */
export const dispatchOrder = async ({ identifier, items, total, currency }) => {
    if (!hasWindow() || !identifier || !window.crypto || !window.crypto.subtle) return false;

    const orderRefHash = await sha256Hex(String(identifier));
    if (orderAlreadySent(orderRefHash)) return false;

    emit({
        t: 'order',
        order_ref_hash: orderRefHash,
        items: normalizeItems(items),
        total,
        currency
    });
    return true;
};
