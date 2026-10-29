import { useEffect } from 'react';
import { dispatchCart, normalizeItems } from './assistantEvents';

const CART_SIG_KEY = 'bradsearch:cart_sig';
const SNAPSHOT_DELAY_MS = 300;

const readSignature = () => {
    try {
        return window.sessionStorage.getItem(CART_SIG_KEY);
    } catch (e) {
        return null;
    }
};

const writeSignature = (signature) => {
    try {
        window.sessionStorage.setItem(CART_SIG_KEY, signature);
    } catch (e) { /* storage blocked: only the de-duplication across reloads is lost */ }
};

// Last signature seen in this page (survives remounts of the hook)
let lastSignature = null;

/**
 * Send the cart as a snapshot, never as add/remove deltas. Covers widget adds, gallery adds
 * and mini cart removals. Debounced (300 ms), de-duplicated by signature, and an emptied cart
 * is a snapshot too. A cart that is empty from the start sends nothing.
 *
 * @param {Object} params
 * @param {Array} [params.items] - Venia `cart.details.items`: product.id, configured_variant.id, quantity.
 *   Leave undefined while the cart is loading.
 * @param {string} [params.cartId]
 */
export const useBradSearchCartSnapshot = ({ items, cartId }) => {
    const rows = Array.isArray(items) ? normalizeItems(items) : null;
    const signature = rows
        ? JSON.stringify(rows.map(r => [r.product_id, r.variant_id || 0, r.qty]).sort())
        : null;

    useEffect(() => {
        if (signature === null) return;

        const timer = setTimeout(() => {
            const previous = lastSignature !== null ? lastSignature : readSignature();
            lastSignature = signature;
            if (signature === previous) return;

            writeSignature(signature);
            // nothing to report for a cart that was never filled
            if (previous === null && rows.length === 0) return;

            dispatchCart(rows, cartId);
        }, SNAPSHOT_DELAY_MS);

        return () => clearTimeout(timer);
    }, [signature, cartId]);
};

// Test hook: forget the signature kept in this page
export const resetCartSnapshotState = () => {
    lastSignature = null;
};
