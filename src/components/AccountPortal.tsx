'use client';
import { useEffect, useRef, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { accountRequest, captureAccountSnapshot, downloadSnapshot, SIGN_IN_URL, validateAccountSnapshot, type Account, type SavedCanvas } from '@/core/account/account';
import { getVaultHealth } from '@/core/vault/vaultStorage';
import { importVault, type OmniVaultExport } from '@/core/vault/vaultExport';

function BackupMetadata({ save }: { save: SavedCanvas }) {
    const date = new Date(save.createdAt);
    const validDate = Number.isFinite(date.getTime());
    return <small><time dateTime={validDate ? date.toISOString() : undefined}>{validDate ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'}</time> · {Number.isFinite(save.bytes) ? `${Math.max(1, Math.ceil(save.bytes / 1024))} KB` : 'Size unavailable'}</small>;
}

export function AccountPortal() {
    const [account, setAccount] = useState<Account | null>(null);
    const [open, setOpen] = useState(false);
    const [saves, setSaves] = useState<SavedCanvas[]>([]);
    const [name, setName] = useState('My Flyspace canvas');
    const [notice, setNotice] = useState('');
    const [operation, setOperation] = useState<'saving' | 'downloading' | 'restoring' | null>(null);
    const busy = operation !== null;
    const busyRef = useRef(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const panelTitle = useRef<HTMLHeadingElement>(null);
    const cancelRestore = useRef<HTMLButtonElement>(null);
    const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [listError, setListError] = useState('');
    const [retryAvailable, setRetryAvailable] = useState(false);
    const [restore, setRestore] = useState<SavedCanvas | null>(null);
    const identity = useRef<string | null>(null);
    const generation = useRef(0);
    const loadSequence = useRef(0);
    const refreshSequence = useRef(0);
    const pending = useRef<{ userId: string; body: { app: 'omni'; name: string; payload: OmniVaultExport; requestId: string } } | null>(null);
    const current = (userId: string, version: number) => identity.current === userId && generation.current === version;
    const assertCurrent = (userId: string, version: number) => {
        if (!current(userId, version)) throw new Error('Your account changed. Reopen your account panel before continuing. Your browser canvas is safe.');
    };
    const refresh = async (userId: string, version: number) => {
        const sequence = ++refreshSequence.current;
        setListState('loading'); setListError('');
        try {
            const result = await accountRequest<{ saves: SavedCanvas[] }>('saves?app=omni', undefined, userId);
            if (current(userId, version) && sequence === refreshSequence.current) { setSaves(result.saves); setListState('ready'); }
        } catch (error) {
            if (current(userId, version) && sequence === refreshSequence.current) {
                setListState('error'); setListError(error instanceof Error ? error.message : 'Account backups are unavailable.');
            }
            throw error;
        }
    };
    useEffect(() => {
        let active = true;
        const apply = (value: Account | null, sequence: number) => {
            if (!active || sequence !== loadSequence.current) return;
            const next = value?.user.id ?? null;
            if (identity.current !== next) {
                identity.current = next; generation.current++;
                setSaves([]); setRestore(null); setNotice(''); setListState('loading'); setListError(''); setOpen(false);
            }
            setAccount(value);
        };
        const load = () => {
            const sequence = ++loadSequence.current;
            return accountRequest<Account>('account').then(value => apply(value, sequence)).catch(() => apply(null, sequence));
        };
        void load();
        window.addEventListener('focus', load);
        return () => { active = false; window.removeEventListener('focus', load); };
    }, []);
    useEffect(() => {
        if (!open || !account) return;
        const userId = account.user.id; const version = generation.current;
        void refresh(userId, version).catch(() => {});
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyRef.current) { generation.current++; setOpen(false); setRestore(null); trigger.current?.focus(); } };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
    }, [open, account]);
    useEffect(() => { if (open) panelTitle.current?.focus(); }, [open]);
    useEffect(() => { if (restore) cancelRestore.current?.focus(); }, [restore]);
    const close = () => { generation.current++; setOpen(false); setRestore(null); trigger.current?.focus(); };
    const perform = async (kind: 'saving' | 'downloading' | 'restoring', action: () => Promise<void>) => {
        if (busyRef.current) return;
        const userId = identity.current; const version = generation.current;
        busyRef.current = true; setOperation(kind); setNotice('');
        try { await action(); } catch (error) { if (userId && current(userId, version)) setNotice(error instanceof Error ? error.message : 'Account storage is unavailable. Your browser canvas is safe.'); }
        finally { busyRef.current = false; setOperation(null); }
    };
    if (!account) return <a href={SIGN_IN_URL} className="account-entry"><UserRound size={15} aria-hidden="true" />Sign in</a>;
    return <div className="account-control">
        <button ref={trigger} className="account-entry" disabled={busy} onClick={() => { if (open) close(); else { generation.current++; setOpen(true); } }} aria-expanded={open} aria-controls="account-portal"><UserRound size={15} aria-hidden="true" />Account</button>
        {open && <section id="account-portal" className="account-panel" aria-label="Your SyberLabs account">
            <div className="account-panel-heading"><div><small>SYBERLABS / YOUR ORBIT</small><h2 ref={panelTitle} tabIndex={-1}>{account.user.label}</h2></div><button aria-label="Close account panel" disabled={busy} onClick={close}><X size={18} /></button></div>
            <a className="account-portal-link" href="https://syberlabs.io/admin/">Enter your portal ↗</a>
            <p>Your canvas stays in this browser. Save a private backup to your account when you choose; notes and conversation content are included.</p>
            <label htmlFor="account-save-name">Backup name</label>
            <input id="account-save-name" autoComplete="off" disabled={busy} value={name} maxLength={100} onChange={event => { setName(event.target.value); pending.current = null; setRetryAvailable(false); }} />
            <div className="account-actions" aria-busy={busy}><button disabled={busy || !name.trim()} onClick={() => void perform('saving', async () => {
                const userId = account.user.id; const version = generation.current;
                if (pending.current && pending.current.userId !== userId) throw new Error('This retry belongs to your previous account. Sign back into that account to retry, or change the backup name to start a new save. Your browser canvas is safe.');
                if (!pending.current) {
                    const payload = await captureAccountSnapshot();
                    assertCurrent(userId, version);
                    pending.current = { userId, body: { app: 'omni', name: name.trim(), payload, requestId: crypto.randomUUID() } };
                    setRetryAvailable(true);
                }
                await accountRequest('saves', pending.current.body, pending.current.userId);
                pending.current = null; setRetryAvailable(false);
                if (!current(userId, version)) return;
                setNotice('Private canvas backup saved to your account.');
                try { await refresh(userId, version); } catch { if (current(userId, version)) setNotice('Your backup was saved. The list is unavailable; view saved things in your portal.'); }
            })}>{operation === 'saving' ? 'Saving backup…' : 'Save to account'}</button><button disabled={busy} onClick={() => void perform('downloading', async () => { downloadSnapshot(await captureAccountSnapshot()); setNotice('Browser backup downloaded.'); })}>{operation === 'downloading' ? 'Downloading…' : 'Download backup'}</button></div>
            <p role="status" className="account-notice">{operation ? { saving: 'Saving a private backup…', downloading: 'Preparing your browser backup…', restoring: 'Checking this backup and restoring your canvas…' }[operation] : notice}</p>
            {!busy && retryAvailable && <p className="account-retry">Retry saves the same captured canvas. Change the name to capture a new backup.</p>}
            {restore && <div className="account-restore" role="group" aria-label={`Restore ${restore.name}`}><h3>Open this backup?</h3><BackupMetadata save={restore} /><p>Restore “{restore.name}” and replace this browser canvas? A local backup will download first. Imported write actions will need approval again.</p><div className="account-actions" aria-busy={busy}><button disabled={busy} onClick={() => void perform('restoring', async () => {
                const userId = account.user.id; const version = generation.current;
                const result = await accountRequest<{ save: SavedCanvas }>(`saves/${encodeURIComponent(restore.id)}`, undefined, userId);
                assertCurrent(userId, version);
                if (result.save.app !== 'omni') throw new Error('This backup belongs to another application.');
                const snapshot = validateAccountSnapshot(result.save.payload);
                const before = await captureAccountSnapshot();
                assertCurrent(userId, version);
                downloadSnapshot(before, 'flyspace-before-restore');
                const previousFailure = getVaultHealth().lastFailure;
                await importVault(snapshot);
                if (getVaultHealth().lastFailure !== previousFailure) throw new Error('Browser storage could not finish restoring. Keep the downloaded backup and try again.');
                window.location.reload();
            })}>{operation === 'restoring' ? 'Restoring canvas…' : 'Restore canvas'}</button><button ref={cancelRestore} disabled={busy} onClick={() => { setRestore(null); panelTitle.current?.focus(); }}>Cancel</button></div></div>}
            <div className="account-list-heading"><h3>Saved canvases</h3><button disabled={busy || listState === 'loading'} onClick={() => { const userId = account.user.id; const version = generation.current; void refresh(userId, version).catch(() => {}); }}>Reload backups</button></div>
            {listState === 'loading' && <p role="status">Loading account backups…</p>}
            {listState === 'error' && <p role="alert" className="account-list-error">Couldn’t load your backup list. {listError} Use Reload backups to try again.</p>}
            {listState === 'ready' && saves.length === 0 && <p>No account backups yet. Save a canvas above to keep a private copy here.</p>}
            <ul className="account-save-list">{saves.map(save => <li key={save.id}><span>{save.name}<BackupMetadata save={save} /></span><button disabled={busy || listState !== 'ready'} aria-label={`Restore backup ${save.name}`} onClick={() => setRestore(save)}>Restore</button></li>)}</ul>
        </section>}
    </div>;
}
