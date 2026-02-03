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
import { BradSearchAnalyticsProvider } from '@bradsearch/brad-verkter-analytics';
import { useAppContext } from '@magento/peregrine/lib/context/app';
import { useCartContext } from '@magento/peregrine/lib/context/cart';

function AnalyticsWrapper({ children }) {
  const [{ storeConfig }] = useAppContext();
  const [cartState] = useCartContext();

  const isEnabled = storeConfig?.bradsearch_analytics_enabled === '1' ||
                    storeConfig?.bradsearch_analytics_enabled === true;

  if (!isEnabled || !storeConfig?.bradsearch_analytics_website_id) {
    return <>{children}</>;
  }

  return (
    <BradSearchAnalyticsProvider
      websiteId={storeConfig.bradsearch_analytics_website_id}
      enabled={isEnabled}
      cartId={cartState?.cartId}
    >
      {children}
    </BradSearchAnalyticsProvider>
  );
}
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
