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
import { useCartContext } from '@magento/peregrine/lib/context/cart';

const [
    {
        cartId
    },
] = useCartContext();

// Get BradSearch tracker instance once at hook level
const bradSearchTracker = useBradSearchTracker();

removeFromCartEvent: data => {
    // Existing GTM tracking
    pushTag('remove_from_cart', removeFromCart(data));

    // BradSearch tracking
    if (bradSearchTracker && Array.isArray(data)) {
        data.forEach(item => {
            if (item?.product?.id) {
                try {
                    bradSearchTracker.trackRemoveFromCart({
                        cartId: cartId,
                        productId: parseInt(item.product.id)
                    });
                } catch (error) {
                    console.error('[BradSearch Analytics] Error tracking remove-from-cart:', error);
                }
            }
        });
    }
}

addToCartEvent: data => {
    // Existing GTM tracking
    pushTag('add_to_cart', addToCartTag(data));

    // BradSearch tracking
    if (bradSearchTracker && data.id) {
        try {
            bradSearchTracker.trackAddToCart({
                cartId: cartId,
                productId: parseInt(data.id)
            });
        } catch (error) {
            console.error('[BradSearch Analytics] Error tracking add-to-cart:', error);
        }
    }
}
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

## Tracked Events

The provider automatically tracks:

1. **Autocomplete Product Clicks** - When users click products in autocomplete
2. **Autocomplete Responses** - When autocomplete returns results (for impressions)
3. **Cart Enrichment** - Associates tracking with cart ID when provided

## How It Works

The provider uses DOM event listeners to track interactions:
- Listens for `bradsearch-autocomplete-product-click` custom events
- Listens for `bradsearch-autocomplete-success` custom events

These events are dispatched by the `@bradsearch/brad-verkter-autocomplete` component.

## Exports

- `BradSearchAnalyticsProvider` - Main React provider component
- `useBradSearchTracker` - Hook to access tracker instance (advanced usage)
- `DEFAULT_SCRIPT_URL` - Default analytics script URL
