// ============================================
// REGISTRY SEARCH EVAL: is the right API in the top results?
//
// A fixed question set over the real index, scored as recall@k: the share of
// questions with at least one acceptable answer among the top k. It exists so
// "JEV ranks better" is a number, not an impression. Keyword search and a JEV
// re-rank are scored on exactly these questions.
//
// Every expected id was checked against public/api-index.json, and every
// question has at least one installable (OpenAPI 3.x) answer. Questions the
// catalog cannot answer at all (it has no SpaceX API, no Alpha Vantage) are
// left out: that is a coverage gap, not a ranking failure, and counting it
// would blame the ranker for the data.
// ============================================

export interface EvalQuestion {
    query: string;
    /** Any of these in the top k counts as a hit. */
    accept: string[];
}

/** Phrased with the API's own vocabulary. Keyword search should do well here. */
export const LITERAL_QUESTIONS: EvalQuestion[] = [
    { query: 'weather forecast', accept: ['visualcrossing.com:weather', 'interzoid.com:getweathercity'] },
    { query: 'send sms text message', accept: ['nexmo.com:sms'] },
    { query: 'translate text', accept: ['googleapis.com:translate', 'amazonaws.com:translate'] },
    { query: 'calendar events', accept: ['googleapis.com:calendar'] },
    { query: 'currency exchange rates', accept: ['exchangerate-api.com', 'interzoid.com:getcurrencyrate', 'interzoid.com:convertcurrency'] },
    { query: 'send email', accept: ['sendgrid.com', 'amazonaws.com:sesv2', 'amazonaws.com:email'] },
    { query: 'github issues', accept: ['github.com', 'github.com:api.github.com'] },
    { query: 'geocode an address', accept: ['gov.bc.ca:geocoder'] },
    { query: 'movie reviews', accept: ['nytimes.com:movie_reviews'] },
    { query: 'news articles', accept: ['nytimes.com:article_search', 'nytimes.com:timeswire'] }
];

/**
 * Phrased the way a person asks, sharing few or no words with the right API.
 * This is where keyword search is expected to fail and a re-rank has to earn
 * its place.
 */
export const SEMANTIC_QUESTIONS: EvalQuestion[] = [
    { query: 'is it going to rain tomorrow', accept: ['visualcrossing.com:weather', 'interzoid.com:getweathercity'] },
    { query: 'convert dollars to euros', accept: ['exchangerate-api.com', 'interzoid.com:getcurrencyrate', 'interzoid.com:convertcurrency'] },
    { query: 'text a phone number', accept: ['nexmo.com:sms'] },
    { query: 'what is the price of a share of apple', accept: ['nfusionsolutions.biz'] },
    { query: 'find the latitude and longitude of a street', accept: ['gov.bc.ca:geocoder'] },
    { query: 'schedule a meeting', accept: ['googleapis.com:calendar'] }
];

export interface EvalScore {
    k: number;
    hits: number;
    total: number;
    recall: number;
    misses: string[];
}

/** Score any ranking function: it takes a query and returns ranked ids. */
export function scoreRecall(questions: EvalQuestion[], rank: (query: string) => string[], k: number): EvalScore {
    const misses: string[] = [];
    let hits = 0;
    for (const question of questions) {
        const top = rank(question.query).slice(0, k);
        if (top.some(id => question.accept.includes(id))) hits++;
        else misses.push(question.query);
    }
    return { k, hits, total: questions.length, recall: questions.length === 0 ? 0 : hits / questions.length, misses };
}
