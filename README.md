# @bradsearch/brad-verkter-analytics

BradSearch analytics tracking provider for Verkter storefronts. Self-contained React provider that automatically tracks autocomplete interactions and cart events.

## Installation

```bash
npm install @bradsearch/brad-verkter-analytics
```

## Quick Start

```jsx
import { BradSearchAnalyticsProvider } from '@bradsearch/brad-verkter-analytics';

function App() {
  return (
    <BradSearchAnalyticsProvider websiteId="your-umami-website-id">
      <YourApp />
    </BradSearchAnalyticsProvider>
  );
}
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `websiteId` | `string` | Yes | - | Umami website ID (UUID) |
| `scriptUrl` | `string` | No | `https://analytics.bradsearch.com/script.js` | Umami script URL |
| `enabled` | `boolean` | No | `true` | Enable/disable tracking |
| `debug` | `boolean` | No | `NODE_ENV === 'development'` | Enable debug logging |
| `cartId` | `string` | No | - | Cart ID for cart enrichment |
| `children` | `ReactNode` | Yes | - | App content |

## Magento PWA Studio Integration

```jsx
// 1. Create new package at path packages/peregrine/lib/context/bradSearchAnalytics/index.js

/**
 * BradSearch Analytics Provider
 *
 * Re-exports from @bradsearch/brad-verkter-analytics and wraps with Verkter-specific
 * context integration (storeConfig and cartContext).
 */

import React from 'react';
import { BradSearchAnalyticsProvider as BaseBradSearchAnalyticsProvider, useBradSearchTracker } from '@bradsearch/brad-verkter-analytics';
import { useAppContext } from '../app';
import { useCartContext } from '../cart';

/**
 * BradSearch Analytics Provider Component
 *
 * Wraps the base provider with Verkter-specific context integration.
 * Reads configuration from storeConfig and cart ID from cart context.
 */
export const BradSearchAnalyticsProvider = ({ children }) => {
    const [{ storeConfig }] = useAppContext();
    const [cartState] = useCartContext();

    const isEnabled = storeConfig?.bradsearch_analytics_enabled === '1' ||
        storeConfig?.bradsearch_analytics_enabled === true;

    if (!isEnabled || !storeConfig?.bradsearch_analytics_website_id) {
        return <>{children}</>;
    }

    return (
        <BaseBradSearchAnalyticsProvider
            websiteId={storeConfig.bradsearch_analytics_website_id}
            enabled={isEnabled}
            cartId={cartState?.cartId}
        >
            {children}
        </BaseBradSearchAnalyticsProvider>
    );
};

// Re-export the tracker hook for advanced usage
export { useBradSearchTracker };

// 2. packages/venia-ui/lib/components/Adapter/adapter.js - wrap code with data provider

import { BradSearchAnalyticsProvider } from '@magento/peregrine/lib/context/bradSearchAnalytics';

<BradSearchAnalyticsProvider>
    <ErrorToasts>{children}</ErrorToasts>
</BradSearchAnalyticsProvider>

// 3. packages/peregrine/lib/talons/Header/storeSwitcher.gql.js

bradsearch_analytics_enabled
bradsearch_analytics_website_id

// 4. packages/peregrine/lib/store/reducers/app.js

bradsearch_analytics_enabled: false
bradsearch_analytics_website_id: ''

// 5. Now need to extend code to enable custom data tracking. 

// 5.1 packages/peregrine/lib/hooks/useDataLayer.js 

import { useBradSearchTracker } from '@magento/peregrine/lib/context/bradSearchAnalytics';

// Get BradSearch tracker instance once at hook level
const bradSearchTracker = useBradSearchTracker();

 // add new field to existing object
searchProductClickEvent: productId => {
    if (bradSearchTracker && productId) {
        try {
            bradSearchTracker.trackSearchProductClick({
                productId: parseInt(productId)
            });
        } catch (error) {
            console.error('[BradSearch Analytics] Error tracking search product click:', error);
        }
    }
}

// 5.2 packages/venia-ui/lib/components/SearchPage/searchPage.js

// Get search product click tracking handler
const { searchProductClickEvent } = useDataLayer();

<Gallery
    items={data.products.items}
    {/* onProductClick is currently missing. Pass it down so event reaches packages/venia-ui/lib/components/Gallery/item.js  */}
    onProductClick={searchProductClickEvent}
/>

// 5.3 packages/venia-ui/lib/components/Gallery/item.js

const handleProductClick = () => {
    if (onProductClick) {
        onProductClick(item.id);
    }
};

<Link to={productLink} className={classes.images} onClick={handleProductClick}>

<AddToCartbutton item={item} onProductClick={onProductClick} />

// 5.4 packages/venia-ui/lib/components/Gallery/addToCartButton.js

const { item, onProductClick } = props;

const handlePress = async (...props) => {
    if (onProductClick) {
        onProductClick(item.id);
    }
    
    await handleAddToCart(...props);
};
    
<Button
    className={classes.root}
    disabled={isDisabled}
    onPress={handleAddToCart}
    onPress={handlePress}
    priority="high"
    type="button"/>

```

## Search results page (view-search, AI search fields)

Needs `bradsearch/magento-extension` with the `bradsearch_search` field on the GraphQL `products` type.

1. Add the BradSearch block to the `ProductSearch` query (`packages/peregrine/lib/talons/SearchPage/searchPage.gql.js`), inside `products { ... }`:

```graphql
bradsearch_search {
    correlation_id
    ai_search {
        used
        match
    }
    ai_matches {
        product_id
        ai_match
    }
}
```

Keep `id` in `items` - the events use it as the product id.

2. Call the hook in `packages/venia-ui/lib/components/SearchPage/searchPage.js`, after `useSearchPage()`:

```jsx
import { useBradSearchResultsPage } from '@bradsearch/brad-verkter-analytics';

// BradSearch analytics: view-search for each result set shown (query, products, AI search state)
useBradSearchResultsPage({
    query: searchTerm,
    products: data && data.products,
    loading
});
```

Product clicks already sent through `useBradSearchTracker().trackSearchProductClick()` (step 5.1 above) need no change.

## Assistant events

For the BradSearch AI shopping assistant. The provider forwards the widget's page events to analytics (nothing to configure), and the package exports a hook and helpers for the PWA to feed it. Every event carries the A/B tag (`window.bradsearchAbTag`, or the tag the widget stored in `localStorage['bradsearch:abtag']`) as `tag`. Events go through `window.umami.track` (analytics-core 1.2.0 cannot add a tag), so the Umami script must be loaded; the provider does that.

| Source | Analytics event | Data |
|---|---|---|
| `bradsearch-context` `{t:'search'}` | `search-committed` | `query`, `total`, `c: 1` |
| `bradsearch-context` `{t:'product_view'}` | `product-view` | `product_id`, `src`, `qid` |
| `bradsearch-context` `{t:'cart'}` | `cart` | `items: [{product_id, variant_id?, qty}]`, `cart_id` |
| `bradsearch-context` `{t:'order'}` | `order` | `order_ref_hash`, `items`, `total`, `currency` |
| `bradsearch-assistant-card-click` (from the widget) | `assistant-card-click` | `product_id`, `action: 'click'`, `qid` (the conversation id) |

`product_id` must be numeric; events without one are dropped. The `bradsearch-context` events also feed the widget's session context, so dispatch them through the helpers below rather than tracking directly.

### Cart snapshot

In a component under Venia's cart context (for example next to the `BradSearchAnalyticsProvider`):

```jsx
import { useBradSearchCartSnapshot } from '@bradsearch/brad-verkter-analytics';

const [{ cartId, details }] = useCartContext();
useBradSearchCartSnapshot({ items: details && details.items, cartId });
```

`items` is Venia's `cart.details.items` (`product.id`, `configured_variant.id`, `quantity`; add `configured_variant { id }` to the mini cart fragment to get variant ids). The hook debounces 300 ms, skips a cart identical to the last one sent, sends an emptied cart as a snapshot, and sends nothing for a cart that was empty from the start or is still loading (`items` undefined).

### Helpers

```jsx
import { dispatchSearchCommitted, dispatchProductView, dispatchOrder } from '@bradsearch/brad-verkter-analytics';

// SearchPage, once when a NEW query's results show (not for page, sort or filter changes)
dispatchSearchCommitted(searchTerm, data.products.total_count);

// Product page, once the product has loaded. Reads and clears sessionStorage['bradsearch:last_src']
// (src and qid of the search click or assistant card that led here) when it matches the product
// and is under 10 minutes old.
dispatchProductView(product.id);

// Success page. order_ref_hash is the sha256 of `identifier`; the same order is sent once per
// 7 days (localStorage). Items: [{product_id, variant_id?, qty}] or Venia items (product.id, quantity).
dispatchOrder({ identifier, items, total, currency });
```

Run the tests with `npm test`.

## Tracked Events

The provider automatically tracks:

1. **Autocomplete Product Clicks** - When users click products in autocomplete
2. **Autocomplete Responses** - When autocomplete returns results (for impressions)
3. **Cart Enrichment** - Associates tracking with cart ID when provided

With the search results page wired up (see below):

4. **Search results page views** (`view-search`) - sent by `useBradSearchResultsPage` once per result set shown (new query, page, sort or filter): query, product ids, `ai_used` / `ai_match` and the search's `X-Request-Correlation-ID`
5. **Search results product clicks** (`search-product-click`) - sent through `useBradSearchTracker().trackSearchProductClick()`; on a results page tracked by `useBradSearchResultsPage` the click also carries the product's `ai_match` and the search's correlation id

## How It Works

The provider uses DOM event listeners to track interactions:
- Listens for `bradsearch-autocomplete-product-click` custom events
- Listens for `bradsearch-autocomplete-success` custom events

These events are dispatched by the `@bradsearch/brad-verkter-autocomplete` component.

## Exports

- `BradSearchAnalyticsProvider` - Main React provider component
- `useBradSearchTracker` - Hook to access tracker instance (advanced usage)
- `useBradSearchResultsPage` - Hook that tracks the search results page (view-search)
- `DEFAULT_SCRIPT_URL` - Default analytics script URL
