'use client';

// ============================================
// PROJECT OMNI: PERSONA BLOCK
// AI persona with wired context connections
// ============================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Send,
    ChevronDown,
    ChevronUp,
    Zap,
    Loader2,
    MessageSquare,
    Gem,
    Workflow,
    Square,
    RotateCcw
} from 'lucide-react';
import { useBlockStore, useUIStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { aggregateWireContext } from '@/core/services/wire.service';
import { runPersonaTurn, stopPersonaTurn, regeneratePersonaTurn } from '@/core/services/personaTurn.service';
import { planCascade, hasUpstreamPersonas } from '@/core/services/cascade.service';
import { PersonaType } from '@/core/schemas/shell.schema';
import {
    PersonaBlockData,
    PERSONA_CONFIGS,
    createPersonaBlockData,
    ContextSource,
    PersonaChatMessage
} from '@/core/schemas/wire.schema';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { crystallize } from '@/core/services/crystallize.service';
import { cn } from '@/lib/utils';

interface PersonaBlockViewProps {
    instanceId: string;
}

export function PersonaBlockView({ instanceId }: PersonaBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);
    const getWiresToBlock = useWireStore(state => state.getWiresToBlock);
    const getBlock = useBlockStore(state => state.getBlock);

    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initialize data if needed - do this FIRST
    useEffect(() => {
        if (block && !block.data) {
            // Extract persona type from block schema (e.g., "persona_analyst" -> "analyst")
            const personaType = block.schema.block_id.replace('persona_', '') as PersonaType;
            updateData(instanceId, createPersonaBlockData(personaType));
        }
    }, [block, instanceId, updateData]);

    // Get persona data or create default
    const personaData: PersonaBlockData = (block?.data as PersonaBlockData) ||
        createPersonaBlockData('analyst');

    const config = PERSONA_CONFIGS[personaData.personaType];
    const connectedWires = getWiresToBlock(instanceId);

    // Auto-scroll to bottom of messages - use scrollTop to avoid page shift
    useEffect(() => {
        const container = messagesEndRef.current?.parentElement;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [personaData.messages]);

    const updatePersonaData = useCallback((updates: Partial<PersonaBlockData>) => {
        updateData(instanceId, { ...personaData, ...updates });
    }, [instanceId, personaData, updateData]);

    // Shared real-LLM turn: streams a response from the persona engine and
    // commits it to the block's message history. Used by both chat and Think.
    // Reads the latest persona data from the store on each commit to avoid
    // stale-closure issues during streaming.
    // The turn itself lives in personaTurn.service so the cascade can run a
    // persona this component is not rendering.
    const runTurn = useCallback(
        (userMessage?: string) => runPersonaTurn(instanceId, userMessage),
        [instanceId]
    );

    const runChain = useCallback(async () => {
        const { order } = planCascade(instanceId);
        // Upstream first, sequentially: each persona must see the previous
        // one's finished answer, not a half-streamed draft.
        for (const id of order) {
            const outcome = await runPersonaTurn(id);
            if (outcome.stopped) break;
        }
    }, [instanceId]);

    const handleSendMessage = () => {
        if (!input.trim() || personaData.isThinking) return;
        const message = input.trim();
        setInput('');
        void runTurn(message);
    };

    const handleUpdateContext = useCallback(() => {
        // Use wireService to aggregate context from all connected blocks
        const { context, lastUpdate } = aggregateWireContext(instanceId);

        updatePersonaData({
            currentContext: context,
            lastContextUpdate: lastUpdate
        });
    }, [instanceId, updatePersonaData]);

    // Only offer the chain when there is one: a lone persona has nothing
    // upstream to run, and an always-visible button would imply otherwise.
    const hasChain = hasUpstreamPersonas(instanceId);

    const handleThink = () => {
        if (personaData.isThinking) return;
        // Autonomous analysis: no user message — the engine uses its default
        // "analyze the wired data" task.
        void runTurn();
    };

    const lastAssistantId = [...personaData.messages].reverse().find(m => m.role === 'assistant')?.id;

    const toggleCollapsed = useCallback((e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        updatePersonaData({ isCollapsed: !personaData.isCollapsed });
    }, [personaData.isCollapsed, updatePersonaData]);

    // Collapsed view
    if (personaData.isCollapsed) {
        return (
            <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-[var(--citadel-surface)]"
                onClick={toggleCollapsed}
            >
                <div className="flex items-center gap-3">
                    <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                            {personaData.customName || config.name}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                            {connectedWires.length} connections • {personaData.messages.length} messages
                        </p>
                    </div>
                </div>
                <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full relative">
            {/* Header: name, sources, refresh, collapse */}
            <div className="flex items-center justify-between gap-2 pl-3 pr-1 h-11 border-b border-[var(--sy-line)]">
                <p className="min-w-0 truncate text-sm">
                    <span className="font-semibold text-[var(--sy-text)]">{personaData.customName || config.name}</span>
                    <span className="ml-2 text-[var(--sy-text-3)]">
                        {connectedWires.length === 0 ? 'No wires' : `${connectedWires.length} connected`}
                    </span>
                </p>
                <div className="flex items-center flex-none">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleUpdateContext(); }}
                        className="h-11 px-2 text-sm text-[var(--sy-brand)] hover:underline underline-offset-[3px]"
                    >
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={toggleCollapsed}
                        className="sy-icon-btn"
                        title="Collapse"
                        aria-label="Collapse"
                    >
                        <ChevronUp />
                    </button>
                </div>
            </div>

            {/* Messages - maximized */}
            <div className="flex-1 overflow-auto p-2 space-y-2">
                {personaData.messages.length === 0 ? (
                    // Wires and messages are independent: a wired persona
                    // with no chat is ready to think, not missing context.
                    <div className="flex flex-col items-center justify-center h-full text-center py-6">
                        {connectedWires.length === 0 ? (
                            <>
                                <MessageSquare
                                    className="w-6 h-6 mb-3 text-[var(--sy-text-3)]"
                                    strokeWidth={1.5}
                                />
                                <p className="text-sm text-[var(--text-muted)]">
                                    Wire data blocks to me for context
                                </p>
                                <p className="text-xs text-[var(--text-muted)]/70 mt-1">
                                    Drag from a block&apos;s right port to this block
                                </p>
                            </>
                        ) : (
                            <>
                                <Zap
                                    className="w-6 h-6 mb-3 text-[var(--sy-text-3)]"
                                    strokeWidth={1.5}
                                />
                                <p className="text-sm text-[var(--text-muted)]">
                                    {connectedWires.length} {connectedWires.length === 1 ? 'source' : 'sources'} connected
                                </p>
                                <p className="text-xs text-[var(--text-muted)]/70 mt-1">
                                    Ready. Think, or ask a question.
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    personaData.messages.map(msg => (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex gap-2",
                                msg.role === 'user' ? "justify-end" : "justify-start"
                            )}
                        >
                            <div
                                className={cn(
                                    "max-w-[85%] px-3 py-2 rounded-lg text-sm",
                                    msg.role === 'user'
                                        ? "bg-[var(--sy-surface-2)] text-[var(--sy-text)]"
                                        : "bg-[var(--sy-bg)] text-[var(--sy-text)] border border-[var(--sy-line)]"
                                )}
                            >
                                {msg.role === 'assistant' ? (
                                    <AnswerBody content={msg.content} />
                                ) : (
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                )}
                                <ProvenanceChips
                                    message={msg}
                                    show={msg.role === 'assistant'}
                                />
                                {msg.stopped && (
                                    <p className="mt-1 text-xs text-[var(--text-muted)]">Stopped</p>
                                )}
                                {msg.role === 'assistant' && !msg.content.startsWith('⚠️') && (
                                    <CrystallizeButton
                                        content={msg.content}
                                        personaId={instanceId}
                                    />
                                )}
                                {msg.role === 'assistant' && msg.id === lastAssistantId && !personaData.isThinking && (
                                    <button
                                        type="button"
                                        onClick={() => { void regeneratePersonaTurn(instanceId); }}
                                        className="mt-1.5 flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                        title="Regenerate this answer"
                                    >
                                        <RotateCcw className="w-3 h-3" />
                                        Regenerate
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
                {personaData.isThinking && (
                    <div className="flex gap-2 items-center">
                        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--citadel-surface)] rounded-lg border border-[var(--citadel-border)]">
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--sy-brand)]" aria-hidden="true" />
                            <span className="text-sm text-[var(--sy-text-2)]">{config.name} is thinking…</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-2 border-t border-[var(--sy-line)]">
                <div className="flex gap-1">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                        placeholder={`Ask ${config.name}...`}
                        aria-label={`Ask ${config.name}`}
                        disabled={personaData.isThinking}
                        className="flex-1 min-w-0 h-11 px-3 bg-[var(--sy-bg)] border border-[var(--sy-line-strong)] rounded-lg text-sm text-[var(--sy-text)] placeholder:text-[var(--sy-text-3)] focus:outline-none focus:border-[var(--sy-brand)] disabled:opacity-40"
                    />
                    {hasChain && (
                        <button
                            type="button"
                            onClick={() => { if (!personaData.isThinking) void runChain(); }}
                            disabled={personaData.isThinking}
                            className="sy-icon-btn flex-none disabled:opacity-40"
                            title="Run chain — think upstream personas first, then this one"
                            aria-label="Run chain"
                        >
                            <Workflow />
                        </button>
                    )}
                    {personaData.isThinking ? (
                        <button
                            type="button"
                            onClick={() => { stopPersonaTurn(instanceId); }}
                            className="sy-icon-btn flex-none"
                            title="Stop"
                            aria-label="Stop"
                        >
                            <Square />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleThink}
                            className="sy-icon-btn flex-none"
                            title="Think"
                            aria-label="Think"
                        >
                            <Zap />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleSendMessage}
                        disabled={!input.trim() || personaData.isThinking}
                        className="flex-none w-11 h-11 inline-flex items-center justify-center rounded-lg bg-[var(--sy-text)] text-[var(--sy-on-primary)] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Send"
                    >
                        <Send className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                </div>
            </div>
        </div>
    );
}


// ============================================
// PROVENANCE CHIPS
// The answer to "what does this persona actually know?". Every source that
// fed a turn is named here. Every source is a block on the canvas, so every
// chip is hoverable and lights the thing it names — recollection included,
// since Memory became a wired block rather than a hidden per-persona toggle.
// Memory is styled apart because it is a different kind of evidence from
// live data, not because it is less pointable.
// ============================================

function ProvenanceChips({ message, show }: { message: PersonaChatMessage; show: boolean }) {
    const setHighlightedBlocks = useUIStore(state => state.setHighlightedBlocks);

    // Older messages predate typed sources; fall back to the legacy id list.
    const sources: ContextSource[] =
        message.sources && message.sources.length > 0
            ? message.sources
            : (message.sourcedFrom || []).map(id => ({ id, kind: 'wire' as const, label: id }));

    if (!show || sources.length === 0) return null;

    // One chip per source, ordered so the reader meets evidence before opinion.
    const order: Array<ContextSource['kind']> = ['wire', 'memory', 'inference'];
    const ordered = order.flatMap(k => sources.filter(s => s.kind === k));
    const hasDerived = sources.some(s => s.kind !== 'wire');

    return (
        <div className="mt-2 pt-2 border-t border-[var(--citadel-border)]/60">
            <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs uppercase tracking-wider text-[var(--text-muted)] mr-1">
                    Grounded in
                </span>

                {ordered.map(src => (
                    <SourceChip key={src.id} source={src} onHighlight={setHighlightedBlocks} />
                ))}
            </div>

            {hasDerived && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Dashed sources are recollection or another persona&apos;s answer, not live data.
                </p>
            )}
        </div>
    );
}

const CHIP_STYLE: Record<ContextSource['kind'], { className: string; title: string }> = {
    wire: {
        className:
            'border-[var(--citadel-secondary)]/40 text-[var(--citadel-secondary)] bg-[var(--citadel-secondary)]/10 hover:bg-[var(--citadel-secondary)]/20',
        title: 'Live data — highlight this block on the canvas'
    },
    memory: {
        className:
            'border-dashed border-[var(--truth-amber)]/60 text-[var(--truth-amber)] bg-[var(--truth-amber)]/10 hover:bg-[var(--truth-amber)]/20',
        title: 'Recollection from a Memory block — highlight it on the canvas'
    },
    inference: {
        // Deliberately distinct: an answer resting on another answer is the
        // one case where errors compound, and the reader should see it.
        className:
            'border-dashed border-[var(--citadel-primary)]/60 text-[var(--citadel-primary-glow)] bg-[var(--citadel-primary)]/10 hover:bg-[var(--citadel-primary)]/20',
        title: "Another persona's conclusion — highlight it on the canvas"
    }
};

function SourceChip({
    source,
    onHighlight
}: {
    source: ContextSource;
    onHighlight: (ids: string[]) => void;
}) {
    const style = CHIP_STYLE[source.kind] ?? CHIP_STYLE.wire;
    return (
        <button
            type="button"
            onMouseEnter={() => onHighlight([source.id])}
            onMouseLeave={() => onHighlight([])}
            onFocus={() => onHighlight([source.id])}
            onBlur={() => onHighlight([])}
            data-testid="provenance-chip"
            className={cn(
                'px-1.5 py-0.5 rounded text-xs border transition-colors',
                style.className
            )}
            title={style.title}
        >
            {source.label}
        </button>
    );
}


// ============================================
// ANSWER BODY
// Models answer in markdown because the system prompt asks for grounded,
// structured replies. Rendering that as preformatted text showed every reader
// literal ## and ** — the product's primary output, looking broken.
//
// react-markdown escapes HTML rather than injecting it, which matters here:
// an answer can quote text that came from an external feed.
//
// The element map keeps a 320px-wide block readable — tight spacing, wrapped
// code, and tables that scroll instead of forcing the card wider.
// ============================================

const MD_COMPONENTS = {
    p: (props: React.ComponentProps<'p'>) => <p className="mb-1.5 last:mb-0" {...props} />,
    ul: (props: React.ComponentProps<'ul'>) => (
        <ul className="list-disc pl-4 mb-1.5 last:mb-0 space-y-0.5" {...props} />
    ),
    ol: (props: React.ComponentProps<'ol'>) => (
        <ol className="list-decimal pl-4 mb-1.5 last:mb-0 space-y-0.5" {...props} />
    ),
    li: (props: React.ComponentProps<'li'>) => <li className="leading-snug" {...props} />,
    strong: (props: React.ComponentProps<'strong'>) => (
        <strong className="font-semibold text-[var(--text-primary)]" {...props} />
    ),
    // Headings in a card this small are emphasis, not hierarchy.
    h1: (props: React.ComponentProps<'h1'>) => (
        <p className="font-semibold text-[var(--text-primary)] mt-2 first:mt-0 mb-1" {...props} />
    ),
    h2: (props: React.ComponentProps<'h2'>) => (
        <p className="font-semibold text-[var(--text-primary)] mt-2 first:mt-0 mb-1" {...props} />
    ),
    h3: (props: React.ComponentProps<'h3'>) => (
        <p className="font-semibold text-[var(--text-primary)] mt-2 first:mt-0 mb-1" {...props} />
    ),
    code: ({ className, ...props }: React.ComponentProps<'code'>) =>
        className?.includes('language-') ? (
            <code className="block" {...props} />
        ) : (
            <code
                className="px-1 py-0.5 rounded bg-[var(--citadel-void)] text-[var(--citadel-secondary)] text-xs"
                {...props}
            />
        ),
    pre: (props: React.ComponentProps<'pre'>) => (
        <pre
            className="my-1.5 p-2 rounded bg-[var(--citadel-void)] border border-[var(--citadel-border)] overflow-x-auto text-xs leading-snug"
            {...props}
        />
    ),
    a: (props: React.ComponentProps<'a'>) => (
        <a
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--citadel-secondary)] underline underline-offset-2"
            {...props}
        />
    ),
    blockquote: (props: React.ComponentProps<'blockquote'>) => (
        <blockquote
            className="border-l-2 border-[var(--citadel-border)] pl-2 my-1.5 text-[var(--text-secondary)]"
            {...props}
        />
    ),
    table: (props: React.ComponentProps<'table'>) => (
        <div className="my-1.5 overflow-x-auto">
            <table className="text-xs border-collapse" {...props} />
        </div>
    ),
    th: (props: React.ComponentProps<'th'>) => (
        <th className="border border-[var(--citadel-border)] px-1.5 py-0.5 text-left font-semibold" {...props} />
    ),
    td: (props: React.ComponentProps<'td'>) => (
        <td className="border border-[var(--citadel-border)] px-1.5 py-0.5" {...props} />
    ),
    hr: () => <hr className="my-2 border-[var(--citadel-border)]" />
};

function AnswerBody({ content }: { content: string }) {
    return (
        <div className="text-sm break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {content}
            </ReactMarkdown>
        </div>
    );
}


// ============================================
// CRYSTALLIZE
// data -> insight -> memory -> context for the next question. The button
// reports where the insight went, because an insight you cannot find again
// is not memory.
// ============================================

function CrystallizeButton({ content, personaId }: { content: string; personaId: string }) {
    const setHighlightedBlocks = useUIStore(state => state.setHighlightedBlocks);
    const [result, setResult] = useState<null | { blockId?: string; created: boolean }>(null);

    if (result) {
        return (
            <button
                type="button"
                onMouseEnter={() => result.blockId && setHighlightedBlocks([result.blockId])}
                onMouseLeave={() => setHighlightedBlocks([])}
                className="mt-1.5 flex items-center gap-1 text-xs text-[var(--truth-amber)]"
                title="Highlight the Memory block holding this"
            >
                <Gem className="w-3 h-3" />
                {result.created ? 'Kept in a new Memory block' : 'Kept in Memory'}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={() => {
                const r = crystallize(content, personaId);
                if (r.ok) setResult({ blockId: r.memoryBlockId, created: r.createdBlock });
            }}
            className="mt-1.5 flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--truth-amber)] transition-colors"
            title="Keep this as memory — it becomes a block you can wire anywhere"
        >
            <Gem className="w-3 h-3" />
            Crystallize
        </button>
    );
}

export default PersonaBlockView;
