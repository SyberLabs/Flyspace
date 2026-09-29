> **Status (2026-09-29):** historical — the per-persona `PersonaContextSettings` imports it describes do not exist (a persona's context is its inbound wires), and pool state persists through the OmniVault (IndexedDB), not localStorage. Current roadmap: APEX_PLAN.md.

# OmniOS Memory Architecture

## Three-Tier Memory Hierarchy

OmniOS implements a unified three-tier memory system that serves both Shell Mind (global awareness) and Persona Blocks (task-specific agents).

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKING MEMORY                            │
│  (Per-Persona, Not Persisted, Conversation Context)         │
│  • Persona Block chat history                                │
│  • Current conversation state                                │
│  • Active wired data context                                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  SHORT-TERM MEMORY                           │
│         (Context Pools, Session-Persistent)                  │
│  ┌──────────────┬──────────────┬──────────────┐            │
│  │ Observations │  Inferences  │  Predictions │            │
│  │   (100 max)  │   (50 max)   │   (30 max)   │            │
│  └──────────────┴──────────────┴──────────────┘            │
│  ┌──────────────┬──────────────────────────────┐            │
│  │  Directives  │      Focus Pool              │            │
│  │   (20 max)   │   (5 max, pinned blocks)     │            │
│  └──────────────┴──────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   LONG-TERM MEMORY                           │
│     (Memory Pool, Cross-Session, LocalStorage)               │
│  • Crystallized insights (200 max)                           │
│  • User-saved snapshots                                      │
│  • High-importance patterns                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Memory Tier Details

### 1. Working Memory (Persona Block Level)

**Location:** `PersonaBlockData.messages` and `PersonaBlockData.memory`
**Scope:** Individual persona instance
**Persistence:** None - cleared when block is removed
**Purpose:** Immediate conversation context and active processing

**What it contains:**
- Chat messages between user and persona
- Current wired data from connected blocks
- Temporary reasoning state
- Per-persona working notes

**Access Pattern:**
- Directly managed by each Persona Block
- Not shared between personas
- Refreshed on every interaction

---

### 2. Short-Term Memory (Context Pools)

**Location:** `useMindStore.contextPools`
**Scope:** Shell Mind global + optionally imported by Persona Blocks
**Persistence:** Session-only (lost on page refresh)
**Purpose:** Shell Mind's active awareness and reasoning workspace

#### Pool Breakdown:

##### **Observations Pool** 👁️
- **Max:** 100 entries, 8000 tokens
- **Prune:** Recency (FIFO for oldest)
- **Content:** Shell Mind's automatic awareness of all blocks
- **Use Case:** "What's happening right now across the system?"
- **Example:** `[Polymarket] 15 markets tracked. Top: "Will AI achieve AGI by 2030?" - Yes: 32%`

##### **Focus Pool** 📍
- **Max:** 5 entries, 12000 tokens
- **Prune:** Importance (keeps highest priority)
- **Content:** User-pinned blocks for deep analysis
- **Use Case:** User attention signal - "analyze THESE specific things"
- **Special:** Can be auto-imported by Persona Blocks via `contextSettings.importFocusedBlocks`

##### **Inferences Pool** 💡
- **Max:** 50 entries, 4000 tokens
- **Prune:** Importance
- **Content:** Shell Mind's insights, patterns, connections
- **Use Case:** "What does the data mean? What patterns emerged?"
- **Example:** `Cross-reference detected: Polymarket sentiment aligns with news trends on AI regulation`

##### **Directives Pool** 🎯
- **Max:** 20 entries, 2000 tokens
- **Prune:** FIFO
- **Content:** User instructions and strategic goals
- **Use Case:** "What am I trying to accomplish?"
- **Example:** `Track crypto market sentiment for next 30 days`

##### **Predictions Pool** 🔮
- **Max:** 30 entries, 3000 tokens
- **Prune:** Hybrid (importance + recency)
- **Content:** Shell Mind forecasts and scenarios
- **Use Case:** "What's likely to happen next?"
- **Example:** `Based on current trends, 70% probability of market correction within 2 weeks`

---

### 3. Long-Term Memory (Memory Pool)

**Location:** `useMindStore.contextPools['memory']`
**Scope:** Global, cross-session
**Persistence:** LocalStorage (survives page refresh, browser sessions)
**Purpose:** Crystallized knowledge and important snapshots

**Max:** 200 entries, 16000 tokens
**Prune:** Importance (keeps highest value insights)

**What gets saved here:**
- User-saved block snapshots (via 🧠 button)
- Shell Mind self-curated important insights
- Patterns worth remembering long-term
- Historical context for future sessions

**Access Pattern:**
- Persona Blocks can import via `contextSettings.useGlobalMemory`
- Shell Mind references for continuity across sessions
- Manually saved by user from any block

---

## How Memory Flows

### Shell Mind (Global Awareness)

```
Blocks Update → useMindShellSync() → Observations Pool
                                            ↓
                        Shell Mind Think() → Inferences/Predictions
                                            ↓
                        User pins block → Focus Pool (max 5)
                                            ↓
                        User saves → Memory Pool (persisted)
```

**Auto-Population:**
- Shell Mind automatically observes ALL blocks via `useMindShellSync()`
- No explicit wiring needed
- Continuous background awareness

### Persona Blocks (Explicit Wiring)

```
Data Blocks → Wire Connections → Persona Block Working Memory
                                            ↓
                    Optional Import → Shell Mind Context (via settings)
                                            ↓
                            Chat → Working Memory
                                            ↓
                    User saves → Memory Pool (persisted)
```

**Context Sources:**
1. **Primary:** Explicitly wired blocks (via drag-and-drop wire system)
2. **Optional:** Shell Mind pools (via context settings)
   - `useGlobalObservations`: Import observations pool
   - `importFocusedBlocks`: Import focus pool
   - `useGlobalMemory`: Import long-term memory

---

## Configuration: Persona Block Context Settings

Each Persona Block can optionally tap into Shell Mind's global context:

```typescript
interface PersonaContextSettings {
  useGlobalObservations: boolean;  // Import Shell Mind's observations
  importFocusedBlocks: boolean;     // Auto-import pinned blocks
  useGlobalMemory: boolean;         // Access long-term memory
  maxObservations: number;          // Limit observations import (default: 10)
}
```

**Access:** Click ⚙️ Settings button in Persona Block header

**When to enable:**
- **Global Observations:** Persona needs broad system awareness beyond wired blocks
- **Focused Blocks:** Persona should track user attention signals
- **Global Memory:** Persona needs historical context from past sessions

**When to keep disabled (default):**
- Task-specific persona with narrow focus
- Avoiding information overload
- Testing specific data connections via wires only

---

## Visual Indicators

### Focus/Wire Indicators on Blocks

**Pinned (Focused) Block:**
- 📍 "Focused" badge in header
- Aqua ring: `ring-1 ring-[var(--mind-aqua-surface)]`

**Wired Block:**
- 🔗 Wire count badge (e.g., "🔗 2")
- Amber ring: `ring-1 ring-[var(--truth-amber)]/30`

**Pinned + Wired Block:**
- Both badges shown
- Enhanced aqua ring with glow: `ring-2 ring-[var(--mind-aqua-surface)] shadow-[0_0_20px_rgba(99,255,230,0.3)]`

---

## Pruning Strategies

Different pools use different strategies to manage capacity:

### **FIFO (First In, First Out)**
- Used by: Directives
- Behavior: Oldest entries removed first
- Rationale: Instructions are time-bound, newer goals override older

### **Recency**
- Used by: Observations
- Behavior: Keeps most recent entries
- Rationale: Current state matters more than old observations

### **Importance**
- Used by: Focus, Inferences, Memory
- Behavior: Keeps highest importance scores
- Rationale: Quality over time - critical insights preserved

### **Hybrid (Importance + Recency)**
- Used by: Predictions
- Behavior: Weighted scoring combining both factors (60% importance, 40% recency)
- Rationale: Balance between forecast relevance and temporal validity

---

## Implementation Files

### Core Schema
- [`src/core/schemas/mind.schema.ts`](src/core/schemas/mind.schema.ts) - Context pool definitions
- [`src/core/schemas/wire.schema.ts`](src/core/schemas/wire.schema.ts) - Persona context settings

### Stores
- [`src/core/stores/mindStore.ts`](src/core/stores/mindStore.ts) - Memory pool management
- [`src/core/stores/wireStore.ts`](src/core/stores/wireStore.ts) - Wire connections

### Services
- [`src/core/services/wire.service.ts`](src/core/services/wire.service.ts) - Context aggregation with Shell Mind integration
- [`src/core/hooks/useMindShellSync.tsx`](src/core/hooks/useMindShellSync.tsx) - Automatic Shell Mind awareness

### UI Components
- [`src/blocks/persona/PersonaBlock.tsx`](src/blocks/persona/PersonaBlock.tsx) - Context settings UI
- [`src/components/blocks/BlockCard.tsx`](src/components/blocks/BlockCard.tsx) - Pin/Save buttons
- [`src/components/mind/MindPanel.tsx`](src/components/mind/MindPanel.tsx) - Memory pool visualization

---

## Example: Memory Lifecycle

### Scenario: Tracking Crypto Market Sentiment

1. **User adds blocks:**
   - Polymarket: "Will Bitcoin reach $100K?"
   - News API: Crypto headlines
   - Twitter Sentiment: #Bitcoin analysis

2. **Shell Mind observes (automatic):**
   ```
   Observations Pool:
   - [Polymarket] 1 market: "Bitcoin $100K?" - Yes: 45%
   - [News] 25 articles on crypto regulation
   - [Twitter] #Bitcoin sentiment: 62% positive
   ```

3. **User pins Polymarket block:**
   ```
   Focus Pool (1/5):
   - [POLYMARKET FOCUS] Full market details with volume, timeline
   ```

4. **User creates Analyst Persona Block:**
   - Wires: Polymarket → Analyst
   - Settings: Enable "Focused Blocks" + "Global Observations"

5. **Analyst context aggregation:**
   ```
   ## 🎯 Focused Context
   [Full Polymarket data from pinned block]

   ## 🌐 Shell Mind Observations (last 10)
   - [News] 25 articles on crypto regulation
   - [Twitter] #Bitcoin sentiment: 62% positive

   ## Polymarket
   [Wired block data - specific market]
   ```

6. **User asks Analyst:** "Should I be bullish on Bitcoin?"

7. **Analyst responds** using combined context (wired + Shell Mind)

8. **User clicks 🧠 on Analyst response:**
   ```
   Memory Pool:
   [Snapshot] Based on market data (45% probability), news sentiment, and...
   ```

9. **Next session (days later):**
   - Observations cleared (session-only)
   - Focus cleared (unless re-pinned)
   - Memory Pool intact → Analyst can reference past analysis

---

## Best Practices

### For Shell Mind Usage
1. **Pin blocks** when you want deep analysis (max 5)
2. **Save to memory** important insights for future reference
3. **Clear focus pool** regularly to maintain signal clarity
4. **Review context pools** in Mind Panel to see Shell Mind's awareness

### For Persona Block Usage
1. **Wire explicitly** - be intentional about data sources
2. **Enable Shell Mind import** only when broad context needed
3. **Keep focused** - too many wires or imports = information overload
4. **Use working memory** for conversation, memory pool for insights

### For System Performance
1. **Memory pools auto-prune** - trust the strategies
2. **Focus pool limited to 5** - prevents attention diffusion
3. **Session-based short-term** - fresh start each session
4. **Importance scoring** - high-value insights preserved across sessions
