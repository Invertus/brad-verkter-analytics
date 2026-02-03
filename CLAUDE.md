# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

React provider package (`@bradsearch/brad-verkter-analytics`) that provides analytics tracking for Verkter storefronts. Self-contained provider that automatically tracks autocomplete interactions and cart events using `@bradsearch/analytics-core`.

## Architecture

The provider wraps the application and sets up DOM event listeners for tracking:
- Autocomplete product clicks (`bradsearch-autocomplete-product-click` events)
- Autocomplete responses (`bradsearch-autocomplete-success` events)
- Cart enrichment via optional `cartId` prop

**Key files:**
- `src/BradSearchAnalyticsProvider.js` - Main React provider component with event listeners
- `src/config/constants.js` - Default script URL constant

**Data flow:**
1. Provider receives `websiteId` prop (required) and optional `scriptUrl`, `enabled`, `cartId`
2. Dynamically imports `@bradsearch/analytics-core` when enabled
3. Initializes Umami tracker with provided configuration
4. Listens for DOM events and tracks automatically
5. Updates cart enrichment when `cartId` changes

## Development

```bash
npm install   # Install dependencies
npm run build # Build dist/ from src/
```

The package uses Babel to transpile JSX and modern syntax before publishing. The `prepublishOnly` script runs `npm run build` automatically.

## Build Output

- Source files live in `src/`
- Babel compiles to `dist/` (excluded from git, included in npm package)
- Published package only contains `dist/` folder

## Integration Notes

- `websiteId` is the only required prop
- `scriptUrl` defaults to `https://analytics.bradsearch.com/script.js`
- `enabled` defaults to `true`
- `debug` defaults to `NODE_ENV === 'development'`
- Pass `cartId` from your cart context to enable cart enrichment
- The provider is SSR-safe (checks for `document` before adding listeners)
