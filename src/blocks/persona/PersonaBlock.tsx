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
    Plug,
    MessageSquare,
    Gem,
    Workflow,
    Square,
    RotateCcw
} from 'lucide-react';
import { useBlockStore, useUIStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
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
import { LineageToggle } from './RunLineage';

interface PersonaBlockViewProps {
    instanceId: string;
}

export function PersonaBlockView({ instanceId }: PersonaBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);
    const getWiresToBlock = useWireStore(state => state.getWiresToBlock);
    const draft = useUIStore(state => state.drafts[instanceId]);

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
    }, [personaData.messages, draft]);

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
                    <span className="text-2xl">{config.avatar}</span>
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
            {/* Compact Header */}
            <div
                className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--citadel-border)]/50"
                style={{ backgroundColor: `${config.color}08` }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-base">{config.avatar}</span>
                    <div>
                        <p className="text-xs font-medium" style={{ color: config.color }}>
                            {personaData.customName || config.name}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div
                        className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                        style={{ backgroundColor: `${config.color}20`, color: config.color }}
                    >
                        <Plug className="w-3 h-3" />
                        {connectedWires.length}
                    </div>
                    <button
                        onClick={toggleCollapsed}
                        className="p-1 hover:bg-[var(--citadel-surface)] rounded transition-colors"
                        title="Collapse"
                    >
                        <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" />
                    </button>
                </div>
            </div>

            {/* Compact Context Status */}
            <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--citadel-border)]/50 bg-[var(--citadel-surface)]/30">
                <span className="text-[10px] text-[var(--text-muted)]">
                    {connectedWires.length === 0 ? 'No wires' : `${connectedWires.length} connected`}
                </span>
            </div>

            {/* Messages - maximized */}
            <div className="flex-1 overflow-auto p-2 space-y-2">
                {personaData.messages.length === 0 && !draft ? (
                    // Wires and messages are independent: a wired persona
                    // with no chat is ready to think, not missing context.
                    <div className="flex flex-col items-center justify-center h-full text-center py-6">
                        {connectedWires.length === 0 ? (
                            <>
                                <MessageSquare
                                    className="w-8 h-8 mb-2 opacity-50"
                                    style={{ color: config.color }}
                                />
                                <p className="text-sm text-[var(--text-muted)]">
                                    Wire data blocks to me for context
                                </p>
                                <p className="text-xs text-[var(--text-muted)]/70 mt-1">
                                    Drag from block edge → drop here
                                </p>
                            </>
                        ) : (
                            <>
                                <Zap
                                    className="w-8 h-8 mb-2 opacity-50"
                                    style={{ color: config.color }}
                                />
                                <p className="text-sm text-[var(--text-muted)]">
                                    {connectedWires.length} {connectedWires.length === 1 ? 'source' : 'sources'} connected
                                </p>
                                <p className="text-xs text-[var(--text-muted)]/70 mt-1">
                                    {process.env.NEXT_PUBLIC_OMNI_PUBLIC_DEMO === '1'
                                        ? 'AI answers are off in the public preview'
                                        : 'Ready — Think, or ask a question'}
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
                            {msg.role === 'assistant' && (
                                <span className="text-lg flex-shrink-0">{config.avatar}</span>
                            )}
                            <div
                                className={cn(
                                    "max-w-[85%] px-3 py-2 rounded-lg text-sm",
                                    msg.role === 'user'
                                        ? "text-white"
                                        : "bg-[var(--citadel-surface)] text-[var(--text-primary)] border border-[var(--citadel-border)]"
                                )}
                                style={msg.role === 'user' ? { backgroundColor: config.color } : undefined}
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
                                {msg.role === 'assistant' && msg.runId && (
                                    <LineageToggle runId={msg.runId} />
                                )}
                                {msg.stopped && (
                                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">Stopped</p>
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
                                        className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
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
                {personaData.isThinking && draft && (
                    // The answer as it streams. It lives in the UI store until
                    // the turn ends and the message is committed to the block.
                    <div className="flex gap-2 justify-start">
                        <span className="text-lg flex-shrink-0">{config.avatar}</span>
                        <div className="max-w-[85%] px-3 py-2 rounded-lg text-sm bg-[var(--citadel-surface)] text-[var(--text-primary)] border border-[var(--citadel-border)]">
                            <AnswerBody content={draft} />
                        </div>
                    </div>
                )}
                {personaData.isThinking && !draft && (
                    <div className="flex gap-2 items-center">
                        <span className="text-lg">{config.avatar}</span>
                        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--citadel-surface)] rounded-lg border border-[var(--citadel-border)]">
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: config.color }} />
                            <span className="text-sm text-[var(--text-muted)]">Thinking...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Compact Input Area */}
            <div className="p-1.5 border-t border-[var(--citadel-border)]/50">
                <div className="flex gap-1">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                        placeholder={`Ask ${config.name}...`}
                        disabled={personaData.isThinking}
                        className="flex-1 px-2 py-1 bg-transparent border border-[var(--citadel-border)]/50 rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-[var(--citadel-primary)] disabled:opacity-50"
                    />
                    {hasChain && (
                        <button
                            onClick={() => { if (!personaData.isThinking) void runChain(); }}
                            disabled={personaData.isThinking}
                            className="p-1 rounded transition-colors disabled:opacity-50 text-[var(--citadel-primary-glow)] bg-[var(--citadel-primary)]/15 hover:bg-[var(--citadel-primary)]/25"
                            title="Run chain — think upstream personas first, then this one"
                        >
                            <Workflow className="w-3 h-3" />
                        </button>
                    )}
                    {personaData.isThinking ? (
                        <button
                            onClick={() => { stopPersonaTurn(instanceId); }}
                            className="p-1 rounded transition-colors"
                            style={{ backgroundColor: `${config.color}20`, color: config.color }}
                            title="Stop"
                        >
                            <Square className="w-3 h-3" />
                        </button>
                    ) : (
                        <button
                            onClick={handleThink}
                            className="p-1 rounded transition-colors"
                            style={{ backgroundColor: `${config.color}20`, color: config.color }}
                            title="Think"
                        >
                            <Zap className="w-3 h-3" />
                        </button>
                    )}
                    <button
                        onClick={handleSendMessage}
                        disabled={!input.trim() || personaData.isThinking}
                        className="p-1 rounded text-white transition-colors disabled:opacity-50"
                        style={{ backgroundColor: config.color }}
                    >
                        <Send className="w-3 h-3" />
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
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
                    Grounded in
                </span>

                {ordered.map(src => (
                    <SourceChip key={src.id} source={src} onHighlight={setHighlightedBlocks} />
                ))}
            </div>

            {hasDerived && (
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
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
                'px-1.5 py-0.5 rounded text-[10px] border transition-colors',
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
                className="px-1 py-0.5 rounded bg-[var(--citadel-void)] text-[var(--citadel-secondary)] text-[11px]"
                {...props}
            />
        ),
    pre: (props: React.ComponentProps<'pre'>) => (
        <pre
            className="my-1.5 p-2 rounded bg-[var(--citadel-void)] border border-[var(--citadel-border)] overflow-x-auto text-[11px] leading-snug"
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
            <table className="text-[11px] border-collapse" {...props} />
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
                className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--truth-amber)]"
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
            className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--truth-amber)] transition-colors"
            title="Keep this as memory — it becomes a block you can wire anywhere"
        >
            <Gem className="w-3 h-3" />
            Crystallize
        </button>
    );
}
