import type { SpatialCommand } from './types';

export function describeCommand(command: SpatialCommand, nameOf: (id: string) => string): string {
    const subject = command.subjects[0] ? nameOf(command.subjects[0]) : 'that block';
    const target = command.target ? nameOf(command.target) : 'that block';

    if (command.lifecycle === 'refused') {
        if (command.reason === 'unrecognized-speech') return "I didn't catch a command.";
        if (command.reason === 'ambiguous-block') return 'Which block do you mean?';
        if (command.reason === 'ambiguous-shell') return 'Which shell do you mean?';
        if (command.reason === 'kept-separate') return 'Those stay separate.';
        if (command.reason === 'nothing-pending') return 'Nothing is waiting for confirm.';
        if (command.reason === 'missing-shell') return "I can't find that shell.";
        if (command.reason === 'missing-block') return "I can't see that block.";
        if (command.reason === 'self-wire') return "I can't wire a block to itself.";
        if (command.reason === 'cross-shell') return 'Those blocks are in different shells.';
        if (
            command.reason === 'incompatible-type' ||
            command.reason === 'no-output' ||
            command.reason === 'no-input'
        ) return "I can't wire those.";
        return "I can't do that.";
    }

    if (command.lifecycle === 'held') {
        if (command.reason === 'missing-point') return 'Point at the canvas, then say it again.';
        if (command.reason === 'ambiguous-target') return 'Say which block to wire to.';
        if (command.reason === 'ambiguous') return 'Point at one block.';
        if (command.reason === 'none') return "I can't see that block.";
        return 'Say that another way.';
    }

    if (command.lifecycle === 'previewing' && command.action === 'delete') {
        return `Say confirm to delete ${subject}.`;
    }

    if (command.lifecycle === 'committed' || command.lifecycle === 'undone') {
        if (command.action === 'undo') return 'Undone.';
        if (command.action === 'cancel') return 'Cancelled.';
        if (command.action === 'create') return `Added ${command.create?.displayName ?? 'a block'}.`;
        if (command.action === 'move') return `Moved ${subject}.`;
        if (command.action === 'connect') return `Wired ${subject} to ${target}.`;
        if (command.action === 'delete') return `Deleted ${subject}.`;
        if (command.action === 'open-shell') return `Opened ${command.create?.displayName ?? 'that shell'}.`;
        if (command.action === 'group') return 'Grouped those blocks.';
        if (command.action === 'separate') return 'Keeping those apart.';
        if (command.action === 'compare') return 'Added a comparison.';
        return 'Done.';
    }

    return 'Done.';
}
