'use client';

// ============================================
// PROJECT OMNI: CHAT BLOCK (Compact UI)
// In-block conversation with the Mind
// ============================================

import { useState, useRef, useEffect } from 'react';
import { useBlockStore, useMindStore } from '@/core/stores';
import { Send, Loader2, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

interface ChatBlockData {
    messages: ChatMessage[];
    lastUpdated: number;
}

interface ChatBlockViewProps {
    instanceId: string;
}

export function ChatBlockView({ instanceId }: ChatBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);
    const activePersona = useMindStore(state => state.getActivePersona());
    const mindStatus = useMindStore(state => state.status);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initialize messages from block data
    useEffect(() => {
        if (block?.data) {
            const data = block.data as ChatBlockData;
            setMessages(data.messages || []);
        }
    }, [block?.data]);

    // Auto-scroll to bottom - use scrollTop to avoid page shift
    useEffect(() => {
        const container = messagesEndRef.current?.parentElement;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'user',
            content: input.trim(),
            timestamp: Date.now()
        };

        const newMessages = [...messages, userMessage];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        updateData(instanceId, {
            messages: newMessages,
            lastUpdated: Date.now()
        });

        try {
            const { aggregateWireContext } = await import('@/core/services/wire.service');
            const { context: wiredContext, sourceIds } = aggregateWireContext(instanceId);

            let fullPrompt = userMessage.content;
            if (sourceIds.length > 0 && wiredContext) {
                fullPrompt = `## Context from Connected Data Sources\n\n${wiredContext}\n\n---\n\n## User Question\n\n${userMessage.content}`;
            }

            const { getMindEngine } = await import('@/core/services/mind.engine');
            const mindEngine = getMindEngine();
            const result = await mindEngine.think(fullPrompt);

            const assistantMessage: ChatMessage = {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: result.success && result.response
                    ? result.response
                    : result.error || 'Could not generate response.',
                timestamp: Date.now()
            };

            const updatedMessages = [...newMessages, assistantMessage];
            setMessages(updatedMessages);
            setIsLoading(false);

            updateData(instanceId, {
                messages: updatedMessages,
                lastUpdated: Date.now()
            });
        } catch (error) {
            console.error('[ChatBlock] Error:', error);
            const errorMessage: ChatMessage = {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: Date.now()
            };

            const updatedMessages = [...newMessages, errorMessage];
            setMessages(updatedMessages);
            setIsLoading(false);

            updateData(instanceId, {
                messages: updatedMessages,
                lastUpdated: Date.now()
            });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Compact Header */}
            <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--citadel-border)]/50">
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[var(--mind-aqua-surface)] to-[var(--citadel-primary)] flex items-center justify-center">
                    <Bot className="w-2.5 h-2.5 text-white" />
                </div>
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                    {activePersona?.name || 'Mind'}
                </span>
                <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    mindStatus === 'ready' ? "bg-[var(--truth-green)]" : "bg-[var(--text-muted)]"
                )} />
            </div>

            {/* Messages - maximized space */}
            <div className="flex-1 overflow-auto p-2 space-y-2">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)]">
                        <Bot className="w-6 h-6 mb-1 opacity-30" />
                        <p className="text-xs">Chat with Mind</p>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex gap-1.5",
                                msg.role === 'user' ? "justify-end" : "justify-start"
                            )}
                        >
                            {msg.role === 'assistant' && (
                                <div className="w-4 h-4 rounded-full bg-[var(--mind-aqua-surface)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Bot className="w-2.5 h-2.5 text-[var(--mind-aqua-surface)]" />
                                </div>
                            )}
                            <div
                                className={cn(
                                    "max-w-[85%] px-2 py-1 rounded-md text-xs leading-relaxed",
                                    msg.role === 'user'
                                        ? "bg-[var(--citadel-primary)] text-[var(--citadel-void)]"
                                        : "bg-[var(--citadel-surface)] text-[var(--text-primary)]"
                                )}
                            >
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div className="flex gap-1.5 items-center text-[var(--text-muted)]">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-[10px]">Thinking...</span>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Slim Input */}
            <div className="p-1.5 border-t border-[var(--citadel-border)]/50">
                <div className="flex gap-1">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message..."
                        className="flex-1 px-2 py-1 bg-transparent border border-[var(--citadel-border)]/50 rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className={cn(
                            "p-1 rounded transition-colors",
                            input.trim() && !isLoading
                                ? "bg-[var(--citadel-primary)] text-[var(--citadel-void)]"
                                : "text-[var(--text-muted)]/50"
                        )}
                    >
                        <Send className="w-3 h-3" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ChatBlockView;
