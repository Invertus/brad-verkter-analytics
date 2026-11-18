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

## Add-to-cart and remove-from-cart

Search revenue reports link a search to an order through the add-to-cart: same shopper, same cart id. Without these two events the dashboard has no "added to cart" step for the store.

Send them through `useBradSearchTracker()`. The tracker adds the provider's `cartId` (the Magento masked quote id from the cart context) by itself, so the call only needs the product and the quantity. Use the parent product id, the same id the search results show.

### 1. `packages/peregrine/lib/hooks/useDataLayer.js`

Today `addToCartEvent` and `removeFromCartEvent` only send to Google (`gtag`). Add the BradSearch call next to it:

```js
removeFromCartEvent: data => {
    pushTag('remove_from_cart', removeFromCart(data));
    if (bradSearchTracker) {
        try {
            data.forEach(item => bradSearchTracker.trackRemoveFromCart({
                productId: parseInt(item.product.id),
                quantity: item.quantity
            }));
        } catch (error) {
            console.error('[BradSearch Analytics] Error tracking remove from cart:', error);
        }
    }
},
addToCartEvent: data => {
    pushTag('add_to_cart', addToCartTag(data));
    if (bradSearchTracker && data && data.id) {
        try {
            bradSearchTracker.trackAddToCart({
                productId: parseInt(data.id),
                quantity: data.quantity || 1
            });
        } catch (error) {
            console.error('[BradSearch Analytics] Error tracking add to cart:', error);
        }
    }
},
```

`addToCartEvent` is called from the category / search grid button (`talons/Gallery/useAddToCartButton.js`) with the gallery item, and `removeFromCartEvent` from the mini cart (`talons/MiniCart/useItem.js`) and the cart page (`components/CartPage/ProductListing/product.js`) with cart items.

### 2. Product page add-to-cart

The product page (`talons/ProductFullDetail/useProductFullDetail.js`, `handleAddToCart`) calls no tracking at all today, not even `gtag`. Call `addToCartEvent` there after the cart mutation succeeds, with the product and the quantity:

```js
const { addToCartEvent } = useDataLayer();
// in handleAddToCart, after the addProductToCart mutation resolved:
addToCartEvent({ ...product, quantity });
```

If other places add to the cart (add-to-cart dialog, compare list, related products), call `addToCartEvent` there too.

### 3. Update the package

Use `@bradsearch/brad-verkter-analytics` 1.4.0 or newer. Older versions send these events without a cart id, and the server drops them.

### Check it

Open the storefront with DevTools, Network tab, filter `api/send`:

* Add a product from a search results grid: one `add-to-cart` with `product_id`, `quantity` and `cart_id`.
* Add a product from the product page: the same.
* Remove it in the mini cart: one `remove-from-cart` with the same `cart_id`.
* `cart_id` equals the cart's masked id (the `cartId` in the PWA cart context, `quote_id_mask.masked_id` in Magento).

## Tracked Events

The provider automatically tracks:

1. **Autocomplete Product Clicks** - When users click products in autocomplete
2. **Autocomplete Responses** - When autocomplete returns results (for impressions)
3. **Cart Enrichment** - Associates tracking with cart ID when provided

With the search results page wired up (see below):

4. **Search results page views** (`view-search`) - sent by `useBradSearchResultsPage` once per result set shown (new query, page, sort or filter): query, product ids, `ai_used` / `ai_match` and the search's `X-Request-Correlation-ID`
5. **Search results product clicks** (`search-product-click`) - sent through `useBradSearchTracker().trackSearchProductClick()`; on a results page tracked by `useBradSearchResultsPage` the click also carries the product's `ai_match` and the search's correlation id
6. **Add-to-cart and remove-from-cart** (`add-to-cart`, `remove-from-cart`) - sent through `useBradSearchTracker().trackAddToCart()` / `trackRemoveFromCart()` from the store's cart code (see above); the tracker adds the provider's `cartId`

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
