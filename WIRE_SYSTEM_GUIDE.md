> **Status (2026-09-29):** historical — it describes a 2-second auto-refresh, `wireService.cleanup`, persona-only drop targets, and localStorage persistence that the code no longer has; wires are now admitted at creation (see TYPED_PORT_SYSTEM.md) and persist through the OmniVault (IndexedDB). Current roadmap: APEX_PLAN.md.

# OmniOS Wire System - Implementation Guide

## Overview

The Wire System enables data flow between **data blocks** (sources) and **persona blocks** (AI agents) through visual connections on the canvas. This document explains how it works and how to troubleshoot issues.

## Architecture

### Components

1. **WireService** (`src/core/services/wire.service.ts`)
   - Manages wire lifecycle
   - Extracts and formats data from source blocks
   - Aggregates context for persona blocks
   - Handles auto-refresh (checks every 2 seconds)

2. **WireHandle** (`src/canvas/WireHandle.tsx`)
   - Visual port on block edges
   - Handles drag-to-connect interaction
   - Shows on RIGHT side for data blocks (source)
   - Shows on LEFT side for persona blocks (target)

3. **WireRenderer** (`src/canvas/WireRenderer.tsx`)
   - Renders SVG wire connections
   - Shows animated data flow
   - Color-coded status (active, stale, error, disconnected)

4. **WireStore** (`src/core/stores/wireStore.ts`)
   - Zustand store for wire state
   - Persists to localStorage
   - CRUD operations for wires

## How to Use

### Creating a Wire Connection

1. **Add blocks to canvas:**
   - Drag a data block (Polymarket, NewsAPI, etc.) from Armory
   - Drag a persona block (Analyst, Strategist, etc.) from Armory

2. **Connect them:**
   - Find the **amber-bordered port** on the RIGHT side of the data block
   - Click and drag from this port
   - A dashed line will follow your cursor
   - Drop on ANY part of the persona block (or its green-bordered LEFT port)
   - Wire connection is created instantly!

3. **Verify connection:**
   - You should see an animated wire with flowing particles
   - The persona block's context status should update
   - Connection count badges appear on ports

### Visual Indicators

**Wire Ports:**
- 🟡 **Amber border** = Source port (data output)
- 🟢 **Green border** = Target port (data input)
- Ports glow and scale on hover
- Badge shows number of connections

**Wire Status Colors:**
- 🔵 **Blue with pulse** = Active (data flowing)
- 🟡 **Amber** = Stale (no update in 5+ minutes)
- 🔴 **Red** = Error
- ⚪ **Gray** = Disconnected

**Wire Animation:**
- Bezier curve between blocks
- Glowing effect on active wires
- Animated particles flow from source → target

### Using Wired Context

Once connected, persona blocks automatically receive formatted context:

```markdown
## Polymarket Live Odds

**Prediction Markets** (5 total)

• Will Trump win 2024 election?
  → Yes: 62.3%

• Bitcoin above $50K by March?
  → Yes: 78.1%

═══════════════════════════════════════

## NewsAPI Feed

**News Feed** (20 articles)

• Tech stocks rally on AI news [📈]
  Reuters • 1/8/2026

• Fed announces rate decision [➖]
  Bloomberg • 1/8/2026
```

Personas use this context to answer questions intelligently.

## Troubleshooting

### Issue: Wire ports not visible

**Possible causes:**
1. CSS not loaded properly
2. Block overflow hiding ports
3. Z-index conflict

**Solutions:**
- Hard refresh browser (Ctrl+Shift+R)
- Check that `.block-card` has `position: relative` and `overflow: visible`
- Verify wire-port styles are in `globals.css`

```css
.wire-port {
  width: 32px;
  height: 32px;
  /* ... see globals.css for full styles */
}
```

### Issue: Wire not connecting when dragging

**Possible causes:**
1. Drop target not detected
2. JavaScript error in WireHandle
3. Dropping on wrong block type

**Debug steps:**
1. Open browser console (F12)
2. Look for errors when attempting connection
3. Verify you're dropping on a **persona block** (not another data block)
4. Check that `data-persona-block` attribute exists:
   ```javascript
   // In console:
   document.querySelectorAll('[data-persona-block]')
   ```

**Fallback detection:**
The WireHandle now has multiple detection strategies:
- First tries `[data-persona-block]` attribute
- Falls back to `.wire-port-target` class
- Searches parent `.block-card` for block ID

### Issue: Context not updating

**Possible causes:**
1. Wire created but auto-refresh not running
2. Source block has no data
3. WireService not imported correctly

**Solutions:**
1. Check wire status - should be "active" (blue)
2. Verify source block shows data (e.g., markets, news)
3. Manually click "Update Context" button on persona block
4. Check console for WireService errors

### Issue: Wires disappear after refresh

**Possible causes:**
1. localStorage not persisting
2. WireStore not loading correctly

**Solutions:**
- Check localStorage in browser DevTools:
  ```javascript
  localStorage.getItem('omni-wires')
  ```
- Should show JSON with wire array
- If empty, wires are not being persisted

## API Reference

### WireService

```typescript
import { wireService } from '@/core';

// Create a wire
const wireId = wireService.createWire(sourceBlockId, targetBlockId, {
  summaryOnly: true,
  timeWindow: 'day',
  autoRefresh: true
});

// Remove a wire
wireService.removeWire(wireId);

// Manually update context
wireService.updateTargetContext(personaBlockId);

// Clean up all auto-refresh intervals
wireService.cleanup();
```

### WireStore

```typescript
import { useWireStore } from '@/core/stores/wireStore';

const wires = useWireStore(state => state.wires);
const getWiresToBlock = useWireStore(state => state.getWiresToBlock);
const wireExists = useWireStore(state => state.wireExists(sourceId, targetId));
```

### Wire Filters

```typescript
interface WireFilters {
  summaryOnly?: boolean;           // Only send summaries (default: false)
  timeWindow?: 'hour' | 'day' | 'week' | 'all';  // Filter by time
  autoRefresh: boolean;            // Auto-update on source change
  fields?: string[];               // Specific fields to include
}
```

## Block Types

### Data Sources (can be wire sources)
- ✅ Polymarket Live Odds
- ✅ NewsAPI Feed
- ✅ Text Note
- ✅ Code Sandbox
- ✅ Media Gallery
- ✅ Web Embed

### Personas (can be wire targets)
- 🎯 Analyst
- ⚔️ Strategist
- 🔬 Researcher
- 🎨 Creative
- 🛡️ Guardian

## Data Format Examples

### Polymarket Data
```markdown
**Prediction Markets** (5 total)

• Will Trump win 2024 election?...
  → Yes: 62.3%
Volume: $2.5M | Ends: 1/15/2026
```

### News Data
```markdown
**News Feed** (20 articles)

• Tech stocks rally on AI news [📈]
  Reuters • 1/8/2026

**Full Article:**
**Tech stocks rally on AI news** [Sentiment: Positive]
Major tech companies saw gains...
*Reuters* • 1/8/2026 10:30 AM
[Read more](https://...)
```

### Text/Code Data
```markdown
## Text Note

[Content up to 500 chars in summary mode, full content otherwise]
```

## Performance Notes

- Auto-refresh checks every 2 seconds (configurable in WireService)
- Context aggregation is synchronous (runs on main thread)
- Large datasets may cause lag - use `summaryOnly: true` filter
- Wire rendering uses Framer Motion for smooth animations
- SVG paths are memoized to prevent re-renders

## Future Enhancements

1. **Wire Filter UI**: Modal to configure filters per-wire
2. **Context Preview**: Tooltip showing context on wire hover
3. **Wire Templates**: Save/load common wire configurations
4. **Batch Operations**: Connect one source to multiple personas
5. **Smart Filtering**: AI-powered relevance filtering
6. **Performance**: Web Workers for heavy data processing

## Developer Notes

### Adding a New Data Source Block

1. Create block hook in `src/blocks/[category]/YourBlock.ts`
2. Ensure data is stored in block using `updateData()`
3. Format data to match one of the supported schemas:
   - Markets: `{ markets: PolymarketMarket[] }`
   - News: `{ articles: NewsArticle[] }`
   - Text: `{ content: string }`
   - Code: `{ code: string, language: string }`
   - Items: `{ items: any[] }`

4. WireService will automatically handle extraction!

### Adding a New Persona Type

1. Add to `PersonaType` in `shell.schema.ts`
2. Add config to `PERSONA_CONFIGS` in `wire.schema.ts`
3. Register block in `BlockRegistry.ts`
4. Persona blocks automatically support wires!

## Testing Checklist

- [ ] Ports visible on data and persona blocks
- [ ] Ports have correct colors (amber for source, green for target)
- [ ] Dragging from source port shows dashed line
- [ ] Dropping on persona creates wire
- [ ] Wire renders with animation
- [ ] Context updates immediately after connection
- [ ] Auto-refresh updates context when data changes
- [ ] Clicking wire prompts removal
- [ ] Removing wire cleans up auto-refresh
- [ ] Wires persist after page refresh
- [ ] Multiple wires from one source work
- [ ] Multiple sources to one persona aggregate correctly

## Support

For issues or questions:
1. Check browser console for errors
2. Verify CSS is loading (inspect wire-port element)
3. Check localStorage for wire persistence
4. Review WireService logs in console
5. Open GitHub issue with reproduction steps

---

**Version:** 1.0.0
**Last Updated:** January 8, 2026
**Author:** OmniOS Team
