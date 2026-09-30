'use client';

// ============================================
// PROJECT OMNI: SETTINGS PANEL
// ============================================

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Settings,
    X,
    Key,
    Database,
    TestTube,
    Check,
    AlertCircle,
    Download,
    Upload,
    HardDrive
} from 'lucide-react';
import { useSettingsStore } from '@/core/stores';
import { testNewsConnection, testPolymarketConnection } from '@/core/services/api.service';
import { exportVault, importVault, isVaultExport } from '@/core/vault';
import { getKeylessApis } from '@/core/schemas/api.schema';
import { cn } from '@/lib/utils';

interface SettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
    const { useMockData, toggleMockData } = useSettingsStore();

    const [testingNews, setTestingNews] = useState(false);
    const [testingPolymarket, setTestingPolymarket] = useState(false);

    const [newsTestResult, setNewsTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [polymarketTestResult, setPolymarketTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [dataResult, setDataResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleExportData = async () => {
        try {
            const exported = await exportVault();
            const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `omni-vault-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setDataResult({ success: true, message: `Exported ${Object.keys(exported.data).length} stores.` });
        } catch {
            setDataResult({ success: false, message: 'Export failed.' });
        }
        setTimeout(() => setDataResult(null), 5000);
    };

    const handleImportData = async (file: File) => {
        try {
            const parsed = JSON.parse(await file.text());
            if (!isVaultExport(parsed)) {
                setDataResult({ success: false, message: 'Not a valid Omni export file.' });
                setTimeout(() => setDataResult(null), 5000);
                return;
            }
            if (!confirm('Importing replaces your current data with the export. Continue?')) return;
            const restored = await importVault(parsed);
            setDataResult({ success: true, message: `Restored ${restored} stores — reloading…` });
            setTimeout(() => window.location.reload(), 800);
        } catch {
            setDataResult({ success: false, message: 'Import failed — file unreadable.' });
            setTimeout(() => setDataResult(null), 5000);
        }
    };

    const handleTestNews = async () => {
        setTestingNews(true);
        const result = await testNewsConnection();
        setTestingNews(false);

        setNewsTestResult({
            success: result.success,
            message: result.success ? 'Connection successful!' : result.error || 'Connection failed'
        });

        setTimeout(() => setNewsTestResult(null), 5000);
    };

    const handleTestPolymarket = async () => {
        setTestingPolymarket(true);
        const result = await testPolymarketConnection();
        setTestingPolymarket(false);

        setPolymarketTestResult({
            success: result,
            message: result ? 'Connection successful!' : 'Connection failed'
        });

        setTimeout(() => setPolymarketTestResult(null), 5000);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="relative bg-[var(--citadel-bg)]/95 backdrop-blur-xl border border-[var(--citadel-border)] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
                        style={{
                            boxShadow: '0 25px 70px rgba(0, 0, 0, 0.6), 0 0 2px rgba(255, 255, 255, 0.1) inset'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-6 border-b border-[var(--citadel-border)]">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-[var(--citadel-primary)]/10 flex items-center justify-center">
                                    <Settings className="w-5 h-5 text-[var(--citadel-primary)]" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                                        System Settings
                                    </h2>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        Data sources and canvas behaviour
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-[var(--citadel-surface)]/50 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-[var(--text-muted)]" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-100px)]">
                            {/* Mock Data Toggle */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Database className="w-4 h-4 text-[var(--citadel-primary)]" />
                                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                        Data Source Mode
                                    </h3>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-[var(--citadel-surface)] rounded-lg border border-[var(--citadel-border)]">
                                    <div>
                                        <p className="text-sm font-medium text-[var(--text-primary)]">
                                            Use Mock Data
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)] mt-1">
                                            {useMockData
                                                ? 'Currently using demo data (no API calls)'
                                                : 'Live API mode enabled'}
                                        </p>
                                    </div>
                                    <button
                                        onClick={toggleMockData}
                                        className={cn(
                                            "relative w-12 h-6 rounded-full transition-colors",
                                            useMockData ? "bg-[var(--citadel-primary)]" : "bg-[var(--citadel-border)]"
                                        )}
                                    >
                                        <motion.div
                                            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-lg"
                                            animate={{ left: useMockData ? '1.5rem' : '0.125rem' }}
                                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                        />
                                    </button>
                                </div>
                            </div>

                            {/* NewsAPI Configuration — server-side via .env */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Key className="w-4 h-4 text-[var(--truth-amber)]" />
                                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                        NewsAPI Configuration
                                    </h3>
                                </div>

                                <div className="space-y-3 p-4 bg-[var(--citadel-surface)] rounded-lg border border-[var(--citadel-border)]">
                                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                        NewsAPI is configured on the server. Set{' '}
                                        <code className="px-1 py-0.5 rounded bg-[var(--citadel-bg)] text-[var(--text-primary)]">NEWSAPI_KEY</code>{' '}
                                        in your <code className="px-1 py-0.5 rounded bg-[var(--citadel-bg)] text-[var(--text-primary)]">.env</code> file
                                        (get a key from{' '}
                                        <a
                                            href="https://newsapi.org/"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[var(--citadel-primary)] hover:underline"
                                        >
                                            newsapi.org
                                        </a>
                                        ). Keys are never stored in the browser.
                                    </p>

                                    <button
                                        onClick={handleTestNews}
                                        disabled={testingNews}
                                        className="w-full px-3 py-2 bg-[var(--truth-amber)] hover:bg-[var(--truth-amber)]/80 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                                    >
                                        <TestTube className="w-4 h-4" />
                                        {testingNews ? 'Testing...' : 'Test Connection'}
                                    </button>

                                    {newsTestResult && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className={cn(
                                                "flex items-center gap-2 p-3 rounded-lg text-sm",
                                                newsTestResult.success
                                                    ? "bg-[var(--truth-green)]/10 text-[var(--truth-green)]"
                                                    : "bg-[var(--truth-red)]/10 text-[var(--truth-red)]"
                                            )}
                                        >
                                            {newsTestResult.success ? (
                                                <Check className="w-4 h-4" />
                                            ) : (
                                                <AlertCircle className="w-4 h-4" />
                                            )}
                                            <span>{newsTestResult.message}</span>
                                        </motion.div>
                                    )}
                                </div>
                            </div>

                            {/* Keyless demo APIs */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Key className="w-4 h-4 text-[var(--truth-green)]" />
                                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                        Demo APIs (no key)
                                    </h3>
                                </div>

                                <div className="space-y-3 p-4 bg-[var(--citadel-surface)] rounded-lg border border-[var(--citadel-border)]">
                                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                        These {getKeylessApis().length} connectors are installed by default and work with nothing in{' '}
                                        <code className="px-1 py-0.5 rounded bg-[var(--citadel-bg)] text-[var(--text-primary)]">.env</code>.
                                        Drag them from the Armory, or spawn World Watch / Investor / Researcher.
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {getKeylessApis().map(api => (
                                            <span
                                                key={api.id}
                                                className="text-xs px-2 py-0.5 rounded-full bg-[var(--truth-green)]/15 text-[var(--truth-green)]"
                                            >
                                                {api.name}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        Polymarket is one of them — a public API with no authentication for basic access.
                                    </p>

                                    <button
                                        onClick={handleTestPolymarket}
                                        disabled={testingPolymarket}
                                        className="w-full px-3 py-2 bg-[var(--truth-green)] hover:bg-[var(--truth-green)]/80 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                                    >
                                        <TestTube className="w-4 h-4" />
                                        {testingPolymarket ? 'Testing...' : 'Test Connection'}
                                    </button>

                                    {polymarketTestResult && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className={cn(
                                                "flex items-center gap-2 p-3 rounded-lg text-sm",
                                                polymarketTestResult.success
                                                    ? "bg-[var(--truth-green)]/10 text-[var(--truth-green)]"
                                                    : "bg-[var(--truth-red)]/10 text-[var(--truth-red)]"
                                            )}
                                        >
                                            {polymarketTestResult.success ? (
                                                <Check className="w-4 h-4" />
                                            ) : (
                                                <AlertCircle className="w-4 h-4" />
                                            )}
                                            <span>{polymarketTestResult.message}</span>
                                        </motion.div>
                                    )}
                                </div>
                            </div>

                            {/* Data Management — OmniVault export/import (apex A2) */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <HardDrive className="w-4 h-4 text-[var(--citadel-primary)]" />
                                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                        Your Data
                                    </h3>
                                </div>

                                <div className="space-y-3 p-4 bg-[var(--citadel-surface)] rounded-lg border border-[var(--citadel-border)]">
                                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                        Shells, wires, and Mind state live locally (IndexedDB via OmniVault).
                                        Export a portable backup, or restore one.
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleExportData}
                                            className="flex-1 px-3 py-2 bg-[var(--citadel-primary)] hover:bg-[var(--citadel-primary-glow)] text-[var(--citadel-void)] text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Download className="w-4 h-4" />
                                            Export data
                                        </button>
                                        <label className="flex-1 px-3 py-2 bg-[var(--citadel-elevated)] border border-[var(--citadel-border)] hover:border-[var(--citadel-primary)] text-[var(--text-primary)] text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer">
                                            <Upload className="w-4 h-4" />
                                            Import data
                                            <input
                                                type="file"
                                                accept="application/json,.json"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) void handleImportData(file);
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>
                                    </div>
                                    {dataResult && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className={cn(
                                                "flex items-center gap-2 p-3 rounded-lg text-sm",
                                                dataResult.success
                                                    ? "bg-[var(--truth-green)]/10 text-[var(--truth-green)]"
                                                    : "bg-[var(--truth-red)]/10 text-[var(--truth-red)]"
                                            )}
                                        >
                                            {dataResult.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                            <span>{dataResult.message}</span>
                                        </motion.div>
                                    )}
                                </div>
                            </div>

                            {/* Info Box */}
                            <div className="p-4 bg-[var(--citadel-primary)]/5 border border-[var(--citadel-primary)]/20 rounded-lg">
                                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                    <strong className="text-[var(--citadel-primary)]">Tip:</strong> Twelve demo APIs need no key.
                                    NewsAPI, FRED, and the other keyed connectors read{' '}
                                    <code className="px-1 py-0.5 rounded bg-[var(--citadel-bg)] text-[var(--text-primary)]">.env</code>{' '}
                                    on the server only — never the browser. Toggle &quot;Use Mock Data&quot; to explore without live calls.
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
