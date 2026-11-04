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
    Plug,
    MessageSquare,
    Workflow,
    RotateCcw
} from 'lucide-react';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { runPersonaTurn, regeneratePersonaTurn } from '@/core/services/personaTurn.service';
import { planCascade, hasUpstreamPersonas } from '@/core/services/cascade.service';
import { PersonaType } from '@/core/schemas/shell.schema';
import {
    PersonaBlockData,
    PERSONA_CONFIGS,
    createPersonaBlockData
} from '@/core/schemas/wire.schema';
import { cn } from '@/lib/utils';

interface PersonaBlockViewProps {
    instanceId: string;
}

export function PersonaBlockView({ instanceId }: PersonaBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);
    const getWiresToBlock = useWireStore(state => state.getWiresToBlock);

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

    const runChain = useCallback(() => {
        // Upstream first, then this persona.
        for (const id of planCascade(instanceId).order) runPersonaTurn(id);
    }, [instanceId]);

    const handleSendMessage = () => {
        if (!input.trim()) return;
        const message = input.trim();
        setInput('');
        runPersonaTurn(instanceId, message);
    };

    // Only offer the chain when there is one: a lone persona has nothing
    // upstream to run, and an always-visible button would imply otherwise.
    const hasChain = hasUpstreamPersonas(instanceId);

    const handleThink = () => runPersonaTurn(instanceId);

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
                {personaData.messages.length === 0 ? (
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
                                    AI answers are off in the public preview
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
                                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                {msg.role === 'assistant' && msg.id === lastAssistantId && (
                                    <button
                                        type="button"
                                        onClick={() => regeneratePersonaTurn(instanceId)}
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
                        className="flex-1 px-2 py-1 bg-transparent border border-[var(--citadel-border)]/50 rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-[var(--citadel-primary)] disabled:opacity-50"
                    />
                    {hasChain && (
                        <button
                            onClick={runChain}
                            className="p-1 rounded transition-colors disabled:opacity-50 text-[var(--citadel-primary-glow)] bg-[var(--citadel-primary)]/15 hover:bg-[var(--citadel-primary)]/25"
                            title="Run chain — think upstream personas first, then this one"
                        >
                            <Workflow className="w-3 h-3" />
                        </button>
                    )}
                    <button
                        onClick={handleThink}
                        className="p-1 rounded transition-colors"
                        style={{ backgroundColor: `${config.color}20`, color: config.color }}
                        title="Think"
                    >
                        <Zap className="w-3 h-3" />
                    </button>
                    <button
                        onClick={handleSendMessage}
                        disabled={!input.trim()}
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

