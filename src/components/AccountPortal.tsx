'use client';
import { useEffect, useRef, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { accountRequest, captureAccountSnapshot, downloadSnapshot, SIGN_IN_URL, validateAccountSnapshot, type Account, type SavedCanvas } from '@/core/account/account';
import { getVaultHealth } from '@/core/vault/vaultStorage';
import { importVault, type OmniVaultExport } from '@/core/vault/vaultExport';

export function AccountPortal() {
    const [account, setAccount] = useState<Account | null>(null);
    const [open, setOpen] = useState(false);
    const [saves, setSaves] = useState<SavedCanvas[]>([]);
    const [name, setName] = useState('My Flyspace canvas');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
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
        const result = await accountRequest<{ saves: SavedCanvas[] }>('saves?app=omni', undefined, userId);
        if (current(userId, version) && sequence === refreshSequence.current) setSaves(result.saves);
    };
    useEffect(() => {
        let active = true;
        const apply = (value: Account | null, sequence: number) => {
            if (!active || sequence !== loadSequence.current) return;
            const next = value?.user.id ?? null;
            if (identity.current !== next) {
                identity.current = next; generation.current++;
                setSaves([]); setRestore(null); setNotice(''); setOpen(false);
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
        void refresh(userId, version).catch(error => { if (current(userId, version)) setNotice(error.message); });
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { generation.current++; setOpen(false); } };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
    }, [open, account, busy]);
    const perform = async (action: () => Promise<void>) => {
        const userId = identity.current; const version = generation.current;
        setBusy(true); setNotice('');
        try { await action(); } catch (error) { if (userId && current(userId, version)) setNotice(error instanceof Error ? error.message : 'Account storage is unavailable. Your browser canvas is safe.'); }
        finally { setBusy(false); }
    };
    if (!account) return <a href={SIGN_IN_URL} className="account-entry"><UserRound size={15} aria-hidden="true" />Sign in</a>;
    return <div className="account-control">
        <button className="account-entry" disabled={busy} onClick={() => { generation.current++; setOpen(value => !value); }} aria-expanded={open} aria-controls="account-portal"><UserRound size={15} aria-hidden="true" />Account</button>
        {open && <section id="account-portal" className="account-panel" aria-label="Your SyberLabs account">
            <div className="account-panel-heading"><div><small>SYBERLABS / YOUR ORBIT</small><h2>{account.user.label}</h2></div><button aria-label="Close account panel" disabled={busy} onClick={() => { generation.current++; setOpen(false); }}><X size={18} /></button></div>
            <a className="account-portal-link" href="https://syberlabs.io/admin/">Enter your portal ↗</a>
            <p>Your canvas stays in this browser. Save a private backup to your account when you choose; notes and conversation content are included.</p>
            <label htmlFor="account-save-name">Backup name</label>
            <input id="account-save-name" disabled={busy} value={name} maxLength={100} onChange={event => { setName(event.target.value); pending.current = null; }} />
            <div className="account-actions"><button disabled={busy || !name.trim()} onClick={() => void perform(async () => {
                const userId = account.user.id; const version = generation.current;
                if (pending.current && pending.current.userId !== userId) throw new Error('This retry belongs to your previous account. Sign back into that account to retry, or change the backup name to start a new save. Your browser canvas is safe.');
                if (!pending.current) {
                    const payload = await captureAccountSnapshot();
                    assertCurrent(userId, version);
                    pending.current = { userId, body: { app: 'omni', name: name.trim(), payload, requestId: crypto.randomUUID() } };
                }
                await accountRequest('saves', pending.current.body, pending.current.userId);
                pending.current = null;
                if (!current(userId, version)) return;
                setNotice('Private canvas backup saved to your account.');
                try { await refresh(userId, version); } catch { if (current(userId, version)) setNotice('Your backup was saved. The list is unavailable; view saved things in your portal.'); }
            })}>Save to account</button><button disabled={busy} onClick={() => void perform(async () => { downloadSnapshot(await captureAccountSnapshot()); setNotice('Browser backup downloaded.'); })}>Download backup</button></div>
            {notice && <p role="status" className="account-notice">{notice}</p>}
            <h3>Saved canvases</h3>
            {saves.length === 0 && <p>No account backups yet.</p>}
            <ul className="account-save-list">{saves.map(save => <li key={save.id}><span>{save.name}<small>{new Date(save.createdAt).toLocaleDateString()} · {Math.ceil(save.bytes / 1024)} KB</small></span><button disabled={busy} onClick={() => setRestore(save)}>Restore</button></li>)}</ul>
            {restore && <div className="account-restore"><p>Restore “{restore.name}” and replace this browser canvas? A local backup will download first. Imported write actions will need approval again.</p><div className="account-actions"><button disabled={busy} onClick={() => void perform(async () => {
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
            })}>Restore canvas</button><button disabled={busy} onClick={() => setRestore(null)}>Cancel</button></div></div>}
        </section>}
    </div>;
}
