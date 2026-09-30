// Spoken replies are feedback. They never carry authority, and a failure here
// leaves the committed command exactly as it was.

export interface SpeechFeedbackAdapter {
    readonly id: string;
    speak(text: string): void;
    cancel(): void;
}

function speechSynth(): SpeechSynthesis | undefined {
    return typeof window === 'undefined' ? undefined : window.speechSynthesis;
}

/**
 * speechSynthesis.cancel() drops every utterance on the page, including the
 * content Speak block. This adapter only stops the utterance it started, and
 * it does not touch the synth until it has spoken.
 */
export function browserSpeechFeedback(): SpeechFeedbackAdapter {
    let owned: SpeechSynthesisUtterance | null = null;

    function cancelOwned(): void {
        const utterance = owned;
        owned = null;
        if (!utterance) return;
        utterance.onend = null;
        utterance.onerror = null;
        utterance.volume = 0;
        const synth = speechSynth();
        if (!synth || synth.pending || !synth.speaking) return;
        synth.cancel();
    }

    return {
        id: 'browser-speech-synthesis',
        speak(text: string) {
            const synth = speechSynth();
            if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
            if (owned) cancelOwned();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';
            owned = utterance;
            utterance.onend = () => {
                if (owned === utterance) owned = null;
            };
            utterance.onerror = () => {
                if (owned === utterance) owned = null;
            };
            synth.speak(utterance);
        },
        cancel() {
            if (!owned) return;
            cancelOwned();
        }
    };
}

export function silentSpeechFeedback(): SpeechFeedbackAdapter {
    return { id: 'silent', speak() {}, cancel() {} };
}

/** Returns false when the feedback adapter failed. The caller's state is untouched either way. */
export function emitFeedback(feedback: SpeechFeedbackAdapter | null, text: string): boolean {
    if (!feedback) return true;
    try {
        feedback.cancel();
        feedback.speak(text);
        return true;
    } catch {
        return false;
    }
}

export function silenceFeedback(feedback: SpeechFeedbackAdapter | null): void {
    try {
        feedback?.cancel();
    } catch {
        // A broken synthesizer cannot block the microphone.
    }
}
