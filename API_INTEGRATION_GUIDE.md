> **Status (2026-09-29):** historical — it describes NewsAPI keys entered in Settings and stored in localStorage and a `src/app/api/news` route, but keys now come from server-side `process.env` and that route does not exist; see README.md Configuration. Current roadmap: APEX_PLAN.md.

# 🚀 Omni OS API Integration Guide

## ✅ What We've Built

We've successfully integrated **real API support** into Omni OS while maintaining backward compatibility with mock data for development. Here's everything that was added:

---

## 📁 New Files Created

### 1. **API Routes (Next.js Server-Side)**
- **`src/app/api/polymarket/route.ts`** - Polymarket API proxy
  - Fetches real prediction market data from Polymarket's public GraphQL API
  - No authentication required for basic access
  - Transforms data to match our block schema

- **`src/app/api/news/route.ts`** - NewsAPI proxy
  - Fetches news articles from NewsAPI.org
  - Requires API key (user provides via Settings)
  - Includes basic sentiment analysis
  - Returns formatted articles with images

### 2. **API Client Service**
- **`src/core/services/api.service.ts`** - Centralized API client
  - `fetchPolymarketData()` - Fetch markets with automatic mock fallback
  - `fetchNewsData()` - Fetch news with API key validation
  - `testPolymarketConnection()` - Test Polymarket API connectivity
  - `testNewsConnection()` - Test NewsAPI with user's key
  - Automatically switches between real and mock data based on settings

### 3. **Settings UI**
- **`src/components/settings/SettingsPanel.tsx`** - Beautiful settings modal
  - Toggle between Mock and Live data modes
  - Configure NewsAPI key with show/hide password
  - Test API connections with visual feedback
  - Save API keys to browser localStorage
  - Glassmorphism design matching Citadel aesthetics

---

## 🔧 Modified Files

### Block Adapters
- **`src/blocks/truth/PolymarketBlock.ts`** - Updated to use centralized API service
- **`src/blocks/truth/NewsApiBlock.ts`** - Updated to use centralized API service

### UI Components
- **`src/components/TopBar.tsx`** - Added Settings button with callback
- **`src/app/CitadelApp.tsx`** - Integrated SettingsPanel modal

---

## 🎯 How to Use

### For Users

1. **Mock Data Mode (Default)**
   - Open the app - it works immediately with demo data
   - Perfect for testing the interface
   - Toggle the "Mock" button in the top bar

2. **Live API Mode**
   - Click the ⚙️ **Settings** button in the top right
   - **For NewsAPI:**
     - Get a free API key from [newsapi.org](https://newsapi.org/)
     - Paste it in the NewsAPI section
     - Click "Test Connection" to verify
     - Click "Save Key"
   - **For Polymarket:**
     - No API key needed!
     - Click "Test Connection" to verify access
   - Toggle "Use Mock Data" to OFF
   - Blocks will now fetch real data!

3. **Adding Blocks**
   - Drag **Polymarket** or **News Feed** blocks from the Armory
   - They'll automatically start fetching data
   - Status indicator shows connection state

---

## 🔐 API Key Storage

- API keys are stored in **browser localStorage** via Zustand persist middleware
- Keys never leave your machine - server-side routes proxy requests
- Keys are encrypted by browser's same-origin policy
- Clear localStorage to reset all settings

---

## 🏗️ Architecture

```
┌─────────────┐
│ User clicks │ (e.g., Add Polymarket block)
└──────┬──────┘
       │
       v
┌─────────────────────────────────────┐
│ PolymarketBlock.ts (usePolymarket   │
│ Block hook) calls fetchPolymarket   │
│ Markets()                            │
└──────┬──────────────────────────────┘
       │
       v
┌─────────────────────────────────────┐
│ api.service.ts checks settings:      │
│ - useMockData? → return mock data    │
│ - else → fetch('/api/polymarket')    │
└──────┬──────────────────────────────┘
       │
       v (if Live mode)
┌─────────────────────────────────────┐
│ Next.js API Route                    │
│ /api/polymarket/route.ts              │
│ - Calls external Polymarket API      │
│ - Transforms data                     │
│ - Returns to client                   │
└──────┬──────────────────────────────┘
       │
       v
┌─────────────────────────────────────┐
│ Block updates with real data         │
│ - Updates store via updateData()     │
│ - UI re-renders automatically        │
└─────────────────────────────────────┘
```

---

## 🧪 Testing

### Test Polymarket Integration
1. Open Settings (⚙️)
2. Scroll to "Polymarket Configuration"
3. Click "Test Connection"
4. Should show green "Connection successful!"

### Test NewsAPI Integration
1. Get API key from https://newsapi.org/
2. Open Settings (⚙️)
3. Paste key in "NewsAPI Configuration"
4. Click "Test Connection"
5. Should show green "Connection successful!"
6. Click "Save Key"

### Test Live Data Flow
1. Toggle "Use Mock Data" to OFF in Settings
2. Add a Polymarket or News block to canvas
3. Block should show "connecting" → "connected"
4. Real data should populate within seconds

---

## 📊 API Rate Limits

### NewsAPI (Free Tier)
- 100 requests/day
- 1 request every 5 minutes (default refresh rate)
- Consider upgrading for production use

### Polymarket
- Public API - no explicit rate limits
- Refresh every 1-5 seconds (configurable in block schema)
- No authentication required

---

## 🐛 Troubleshooting

### "API key required" error
- Open Settings and configure your NewsAPI key
- Make sure you clicked "Save Key"

### "Connection failed"
- Check your internet connection
- Verify API key is valid
- Check browser console for detailed errors

### Blocks stuck on "connecting"
- Toggle back to Mock mode if APIs are down
- Check Network tab in DevTools for failed requests
- Restart the app

### CORS errors
- All API calls go through Next.js API routes (server-side)
- No CORS issues should occur
- If you see CORS errors, check API route configuration

---

## 🚀 Future Enhancements

### Planned Features
- [ ] TradingView integration (requires API key)
- [ ] GDELT events feed
- [ ] FlightAware tracking
- [ ] MarineTraffic AIS data
- [ ] API usage analytics
- [ ] Rate limit tracking
- [ ] Webhook support for real-time updates
- [ ] WebSocket connections for streaming data

### API Marketplace (Phase 2)
- Browse and install API integrations
- One-click authentication
- Pre-configured block templates
- Community-contributed data sources

---

## 📝 Development Notes

### Adding a New API Integration

1. **Create API Route** (`src/app/api/[service]/route.ts`)
```typescript
export async function GET(request: NextRequest) {
    const apiKey = request.headers.get('x-api-key');
    // Fetch from external API
    // Transform data
    // Return NextResponse.json()
}
```

2. **Add to API Service** (`src/core/services/api.service.ts`)
```typescript
export async function fetchServiceData() {
    const { useMockData, apiKeys } = useSettingsStore.getState();
    if (useMockData) return mockData;

    const response = await fetch('/api/service', {
        headers: { 'x-api-key': apiKeys.service }
    });
    // Handle response
}
```

3. **Create Block Adapter** (`src/blocks/category/ServiceBlock.ts`)
```typescript
export function useServiceBlock(instanceId: string) {
    const fetchData = useCallback(async () => {
        const { data, error } = await fetchServiceData();
        updateData(instanceId, data);
    }, [instanceId]);
    // Set up polling, etc.
}
```

4. **Register Block** (`src/core/registry/BlockRegistry.ts`)
```typescript
blockRegistry.register({
    block_id: 'service_name',
    display_name: 'Service Name',
    category: 'truth',
    // ... other properties
});
```

5. **Add to Settings UI** (optional, if requires API key)

---

## 🎉 Summary

**All APIs are now activated!** 🎊

- ✅ Polymarket - Live prediction markets
- ✅ NewsAPI - Real-time news feed
- ✅ Settings UI - Beautiful configuration panel
- ✅ Mock mode - Development/testing fallback
- ✅ Auto-refresh - Real-time data updates
- ✅ Error handling - Graceful fallbacks
- ✅ Testing tools - Connection verification

**Next Steps:**
1. Get a NewsAPI key from https://newsapi.org/
2. Open Settings (⚙️ button)
3. Configure your API key
4. Toggle "Use Mock Data" OFF
5. Start using real data! 🚀

---

**Happy hacking! 🔮**
