// Spoken replies are feedback. They never carry authority, and a failure here
// leaves the committed command exactly as it was.

export interface SpeechFeedbackAdapter {
    readonly id: string;
    speak(text: string): void;
    cancel(): void;
}

export function browserSpeechFeedback(): SpeechFeedbackAdapter {
    return {
        id: 'browser-speech-synthesis',
        speak(text: string) {
            const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
            if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
            synth.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';
            synth.speak(utterance);
        },
        cancel() {
            if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
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
