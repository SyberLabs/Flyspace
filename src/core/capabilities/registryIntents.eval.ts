// ============================================
// INTENT ROUTING EVAL: does JEV pick the right intent?
//
// Held out from the questions in registrySearch.eval.ts, phrased without the
// intents' own words, and aimed at intents that set never exercises. The last
// four are deliberately outside every intent: the right answer there is
// `other`, and a pick of anything else is a miss. Scored live by
// `npm run eval:registry-jev`.
//
// Measured 2026-10-07 on jev-1.13.0: 19/20. The miss was "find me a dog
// walker nearby" → maps (0.99), arguably a local search. "what is the
// bitcoin price" split stocks 0.49 / currency 0.36: genuine ambiguity, both
// routed.
//
// All 20 questions were written by the same author as the intents. That
// bounds the claim: measured on author-written questions, not on users.
// ============================================

export interface IntentQuestion {
    query: string;
    /** Any of these as JEV's top intent counts as right. */
    accept: string[];
}

export const INTENT_QUESTIONS: IntentQuestion[] = [
    { query: 'is this email address real or a throwaway', accept: ['email_validation'] },
    { query: 'where in the world is 8.8.8.8', accept: ['ip_geolocation'] },
    { query: 'how many calories are in a banana', accept: ['food'] },
    { query: 'where is my package right now', accept: ['shipping'] },
    { query: 'did the lakers win last night', accept: ['sports'] },
    { query: 'turn this voice memo into words', accept: ['speech_to_text'] },
    { query: 'read me this paragraph out loud', accept: ['text_to_speech'] },
    { query: 'what does this photo show', accept: ['image_recognition'] },
    { query: 'is this review positive or negative', accept: ['sentiment'] },
    { query: 'best bestsellers this week', accept: ['books'] },
    { query: 'play something by radiohead', accept: ['music'] },
    { query: 'book a hotel in lisbon', accept: ['travel'] },
    { query: 'generate an invoice as a pdf', accept: ['pdf'] },
    { query: 'who has a bank holiday on monday', accept: ['holidays'] },
    { query: 'how far is it to drive from boston to new york', accept: ['routing'] },
    { query: 'what is the bitcoin price', accept: ['stocks', 'crypto_payments', 'other'] },
    // Outside every intent.
    { query: 'find me a dog walker nearby', accept: ['other'] },
    { query: 'write me a poem about the sea', accept: ['other'] },
    { query: 'control my smart lightbulbs', accept: ['other'] },
    { query: 'what time is it in tokyo', accept: ['other'] }
];
