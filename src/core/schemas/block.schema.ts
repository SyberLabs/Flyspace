// ============================================
// PROJECT OMNI: OMNI-SCHEMA TYPE DEFINITIONS
// ============================================

/**
 * Block categories aligned with the "Senses"
 */
export type BlockCategory =
  | 'truth'         // Prediction markets, financials
  | 'physicality'   // Real-world telemetry
  | 'pulse'         // Narrative and sentiment
  | 'model'         // AI models and biomarkers
  | 'workspace'     // User-created content blocks
  | 'system'        // Compiled capability blocks
  | 'environment';  // Weather, quakes, climate

/**
 * Connection status for live data streams
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'paused';

/**
 * Expand behavior for blocks
 */
export type BlockExpandMode = 'resize' | 'portal' | 'fullscreen';

/** Data types shown as visual hints on block wire handles. */
export type PortDataType = 'json' | 'text' | 'media' | 'any';

/**
 * Schema-bearing port contract. Optional so existing catalog ports stay
 * visual hints. When both ends of a wire declare one, the wire is checked.
 */
export interface PortValueSchema {
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array' | 'any';
  description?: string;
  enum?: Array<string | number | boolean | null>;
  properties?: Record<string, PortValueSchema>;
  required?: string[];
  items?: PortValueSchema;
  additionalProperties?: boolean | PortValueSchema;
  format?: string;
  nullable?: boolean;
}

/**
 * Port direction
 */
export type PortDirection = 'input' | 'output';

/**
 * Port definition for block schema
 */
export interface PortSchema {
  /** Port identifier (unique within block) */
  id: string;

  /** Port direction */
  direction: PortDirection;

  /** Declared data type. An identity wire enforces it. A string sink may project. */
  dataType: PortDataType;

  /** Native value contract. Present on capability ports. */
  schema?: PortValueSchema;

  /** Human-readable label */
  label?: string;

  /** Description for tooltip */
  description?: string;
}

/**
 * The core Omni-Schema for API Blocks
 * Every API must be wrapped in this schema to be "Lego-ized"
 */
export interface OmniBlockSchema {
  /** Unique identifier for this block type */
  block_id: string;

  /** Human-readable name */
  display_name: string;

  /** Category of the block */
  category: BlockCategory;

  /** Tags for semantic search and filtering */
  semantic_tags: string[];

  /** Declared ports. A wire is admitted only when an output is compatible with an input. */
  ports?: PortSchema[];

  /** Optional icon identifier */
  icon?: string;

  /** Description for the Armory UI */
  description?: string;

  /** How this block behaves when expanded */
  expandMode?: BlockExpandMode;

  /** Whether this block can be created by the user (vs API-sourced) */
  isUserCreatable?: boolean;

  /** Set when this block type was compiled from a CapabilityManifest. */
  capabilityId?: string;
}

/**
 * Runtime state for an active block instance
 */
export interface BlockInstance {
  /** Unique instance ID */
  instance_id: string;

  /** Reference to the block schema */
  schema: OmniBlockSchema;

  /** Current connection status */
  status: ConnectionStatus;

  /** Last data update timestamp */
  last_updated: number | null;

  /** Current data payload */
  data: unknown;

  /** Error message if status is 'error' */
  error?: string;

  /** Canvas position */
  position: { x: number; y: number };

  /** Canvas dimensions */
  dimensions: { width: number; height: number };

  /** Shell isolation - ID of the shell this block belongs to */
  shellId: string;

  /** Fetch/config knobs for this instance. Absent means never configured. */
  params?: Record<string, unknown>;
}

/**
 * Polymarket-specific data types
 */
export interface PolymarketMarket {
  id: string;
  question: string;
  description?: string;
  outcomes: PolymarketOutcome[];
  volume: number;
  liquidity: number;
  endDate: string;
  category: string;
  tags: string[];
}

export interface PolymarketOutcome {
  id: string;
  name: string;
  probability: number;
  priceHistory?: { timestamp: number; price: number }[];
}

/**
 * NewsAPI-specific data types
 */
export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  source: string;
  author?: string;
  url: string;
  imageUrl?: string;
  publishedAt: string;
  content?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface NewsFeed {
  articles: NewsArticle[];
  totalResults: number;
  query?: string;
  category?: string;
}

/**
 * Legacy shell connection shape. Port IDs remain here only so saved shells
 * from the old connection store can be converted to block-ID DataWires.
 */
export interface BlockConnection {
  id: string;
  sourceBlockId: string;
  sourcePort: string;
  targetBlockId: string;
  targetPort: string;
}
