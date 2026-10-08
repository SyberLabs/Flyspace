// ============================================
// REGISTRY INTENTS: what a person might want an API for.
//
// Keyword search cannot connect "is it going to rain tomorrow" to a weather
// API: they share no words. JEV can, as a bounded choice. The host offers it
// this fixed list of intents as `choice` options; JEV returns a probability
// for each; the host maps the likely intents to APIs it already knows answer
// them. JEV never names an API, a URL or a spec. It picks an id from this
// list, and everything after that is a host-side lookup (MasterMind
// DECISION_PROVIDER_CONTRACT: ids, bounded selection, host re-derivation).
//
// Every `apis` id was chosen by hand and is checked by a test to give
// something to place: it compiles to at least one operation in the index, or
// OmniOS ships it (curatedApis.ts). An intent no usable API answers keeps
// `apis` empty and says why in `unavailable`; search then says so plainly
// instead of offering weak keyword matches. Re-curated 2026-10-07 against
// the compile counts in public/api-index.json. `terms` widen the keyword
// search for the intent. `other` is how JEV says "none of these"; the host then falls back to
// keyword search on the query alone.
//
// The list sets the ceiling: an API no intent covers is still reachable by
// keyword, never by routing. Grow it from measured misses, not completeness.
// ============================================

export interface RegistryIntent {
    id: string;
    /** What JEV reads: the kinds of request that belong here. */
    criteria: string;
    /** Extra keyword search for this intent, run alongside the query. */
    terms: string;
    /** Hand-checked answers, best first. Shown ahead of keyword results. */
    apis: string[];
    /**
     * Why no API answers this yet, when none in the directory compiles to
     * anything usable. Set exactly when `apis` is empty.
     */
    unavailable?: string;
}

/** JEV's "none of these". Never mapped to APIs. */
export const OTHER_INTENT = 'other';

export const REGISTRY_INTENTS: RegistryIntent[] = [
    // --- Weather, places, travel ---
    { id: 'weather', criteria: 'Weather: current conditions, forecasts, rain, snow, temperature, wind.', terms: 'weather forecast', apis: ['visualcrossing.com:weather', 'interzoid.com:getweathercity'] },
    { id: 'geocoding', criteria: 'Turning an address into coordinates, or coordinates into an address.', terms: 'geocode address', apis: ['gov.bc.ca:geocoder'] },
    { id: 'routing', criteria: 'Directions, routes and travel time between places.', terms: 'routing directions', apis: ['graphhopper.com', 'tomtom.com:routing'] },
    { id: 'maps', criteria: 'Maps, map tiles and places of interest.', terms: 'maps', apis: ['tomtom.com:maps'] },
    { id: 'ip_geolocation', criteria: 'Where an IP address is located, or who owns it.', terms: 'ip geolocation', apis: ['abstractapi.com:geolocation', 'bigdatacloud.net'] },
    { id: 'travel', criteria: 'Hotels, flights and trip planning.', terms: 'travel hotels flights', apis: ['impala.travel:hotels', 'amadeus.com:amadeus-travel-recommendations'] },
    { id: 'holidays', criteria: 'Public holidays and days off.', terms: 'holidays', apis: ['canada-holidays.ca'] },

    // --- Communication ---
    { id: 'sms', criteria: 'Sending or receiving text messages (SMS) to a phone.', terms: 'send sms text message', apis: ['sms77.io'] },
    { id: 'voice_calls', criteria: 'Making or receiving phone calls.', terms: 'voice calls', apis: ['nexmo.com:voice'] },
    { id: 'chat', criteria: 'Chat rooms and in-app messaging.', terms: 'chat messaging', apis: ['twilio.com:twilio_chat_v2'] },
    { id: 'email_send', criteria: 'Sending email.', terms: 'send email', apis: [], unavailable: 'The email-sending APIs in the directory (SendGrid, Amazon SES) do not compile yet: no fixed https server, or AWS request signing.' },
    { id: 'email_validation', criteria: 'Checking whether an email address is real, valid or disposable.', terms: 'email validation', apis: ['mailboxvalidator.com:validation', 'mailboxvalidator.com:disposable'] },
    { id: 'phone_lookup', criteria: 'Looking up or validating a phone number: carrier, country, line type.', terms: 'phone number validation', apis: ['interzoid.com:getglobalnumberinfo'] },

    // --- Money ---
    { id: 'currency', criteria: 'Currency exchange rates and converting between currencies.', terms: 'currency exchange rates', apis: ['exchangerate-api.com', 'interzoid.com:getcurrencyrate', 'interzoid.com:convertcurrency'] },
    { id: 'economic_data', criteria: 'Economic statistics over time: GDP, unemployment, inflation, interest rates, money supply.', terms: 'economic data unemployment inflation gdp', apis: ['omni:fred'] },
    { id: 'stocks', criteria: 'Stock and share prices, and financial market data.', terms: 'stock market data prices', apis: ['nfusionsolutions.biz'] },
    { id: 'payments', criteria: 'Taking or sending payments.', terms: 'payments', apis: ['klarna.com:payments', 'velopayments.com'] },
    { id: 'crypto_payments', criteria: 'Accepting cryptocurrency payments.', terms: 'cryptocurrency payments', apis: ['nowpayments.io'] },
    { id: 'banking', criteria: 'Bank accounts, balances and transactions.', terms: 'banking bank accounts', apis: ['codat.io:banking'] },
    { id: 'accounting', criteria: 'Accounting, ledgers and bookkeeping data.', terms: 'accounting', apis: ['apideck.com:accounting', 'codat.io:accounting'] },

    // --- Commerce ---
    { id: 'products', criteria: 'A product catalogue or online store inventory.', terms: 'ecommerce products', apis: ['shop.app'] },
    { id: 'shipping', criteria: 'Shipping labels and tracking parcels.', terms: 'shipping tracking', apis: ['shipengine.com', 'here.com:tracking'] },
    { id: 'barcode', criteria: 'Looking up a product barcode or UPC, or generating barcodes.', terms: 'barcode lookup', apis: ['go-upc.com'] },

    // --- Work and productivity ---
    { id: 'calendar', criteria: 'Calendars, events, meetings and scheduling.', terms: 'calendar events', apis: [], unavailable: 'The calendar APIs in the directory (Google Calendar) need a sign-in OmniOS does not support yet (OAuth), or AWS request signing.' },
    { id: 'tasks', criteria: 'To-do lists and tasks.', terms: 'tasks', apis: [], unavailable: 'The to-do APIs in the directory need a Google sign-in, or have no fixed https server.' },
    { id: 'crm', criteria: 'Customer contacts, leads and deals (CRM).', terms: 'crm contacts', apis: ['apideck.com:crm', 'hubapi.com:crm'] },
    { id: 'support_tickets', criteria: 'Customer support tickets and help desks.', terms: 'customer support tickets', apis: ['apideck.com:customer-support'] },
    { id: 'forms', criteria: 'Forms and surveys, and their responses.', terms: 'forms surveys', apis: ['qualtrics.com'] },
    { id: 'file_storage', criteria: 'Storing and retrieving files.', terms: 'file storage', apis: ['apideck.com:file-storage'] },
    { id: 'pdf', criteria: 'Creating, filling or converting PDF documents.', terms: 'pdf documents', apis: ['pdfgeneratorapi.com', 'api2pdf.com'] },
    { id: 'code', criteria: 'Code repositories, issues and pull requests.', terms: 'github repositories issues', apis: ['github.com'] },
    { id: 'monitoring', criteria: 'Monitoring systems, metrics and alerts.', terms: 'monitoring alerts', apis: [], unavailable: 'The monitoring APIs in the directory (Google, Amazon CloudWatch) need a sign-in OmniOS does not support yet (OAuth), or AWS request signing.' },
    { id: 'questions_answers', criteria: 'Programming questions and answers from a Q&A community.', terms: 'questions answers', apis: ['stackexchange.com'] },

    // --- Language and media understanding ---
    { id: 'translation', criteria: 'Translating text between languages.', terms: 'translate text', apis: [], unavailable: 'The translation APIs in the directory (Google, Amazon) need a sign-in OmniOS does not support yet (OAuth), or AWS request signing.' },
    { id: 'speech_to_text', criteria: 'Transcribing speech or audio into text.', terms: 'speech to text', apis: ['rev.ai'] },
    { id: 'text_to_speech', criteria: 'Turning text into spoken audio.', terms: 'text to speech', apis: [], unavailable: 'The text-to-speech APIs in the directory (Google, Amazon Polly) need a sign-in OmniOS does not support yet (OAuth), or AWS request signing.' },
    { id: 'sentiment', criteria: 'Sentiment, entities or meaning in a piece of text.', terms: 'sentiment text analysis', apis: ['symanto.net'] },
    { id: 'image_recognition', criteria: 'Recognising what is in an image, or reading text in it (OCR).', terms: 'image recognition ocr', apis: ['microsoft.com:cognitiveservices-ComputerVision'] },

    // --- Information and entertainment ---
    { id: 'news', criteria: 'News articles and headlines.', terms: 'news articles', apis: ['nytimes.com:timeswire'] },
    { id: 'movies', criteria: 'Films and movie reviews.', terms: 'movie reviews', apis: ['nytimes.com:movie_reviews'] },
    { id: 'books', criteria: 'Books, authors and bestseller lists.', terms: 'books', apis: ['nytimes.com:books_api'] },
    { id: 'music', criteria: 'Music, songs, artists and playlists.', terms: 'music', apis: [], unavailable: 'Spotify, the music API in the directory, needs an OAuth sign-in OmniOS does not support yet.' },
    { id: 'video_games', criteria: 'Video games and game information.', terms: 'video games', apis: ['rawg.io'] },
    { id: 'sports', criteria: 'Sports scores, schedules and results.', terms: 'sports scores', apis: ['sportsdata.io:nfl-v3-scores', 'sportsdata.io:nba-v3-scores', 'sportsdata.io:mlb-v3-scores'] },
    { id: 'food', criteria: 'Recipes, food and nutrition facts.', terms: 'food nutrition recipes', apis: ['spoonacular.com'] },
    { id: 'space', criteria: 'Space, astronomy, NASA imagery and near-Earth objects.', terms: 'space astronomy nasa', apis: [], unavailable: 'NASA\u2019s APIs in the directory do not compile yet (untyped data shapes, no fixed https server).' },
    { id: 'quotes', criteria: 'Famous quotes and sayings.', terms: 'quotes', apis: ['quotes.rest'] },
    { id: 'blogging', criteria: 'Blog posts and articles on writing platforms.', terms: 'blog posts', apis: ['medium.com', 'dev.to'] },
    { id: 'vehicles', criteria: 'Cars and vehicle listings.', terms: 'vehicles cars', apis: ['apigee.net:marketcheck-cars'] },
    { id: 'energy', criteria: 'Electricity, power and energy data.', terms: 'energy electricity', apis: ['corrently.io'] }
];

/** JEV's options: every intent, plus "none of these". */
export function intentCriteria(intents: readonly RegistryIntent[] = REGISTRY_INTENTS): Record<string, string> {
    return {
        ...Object.fromEntries(intents.map(intent => [intent.id, intent.criteria])),
        [OTHER_INTENT]: 'None of these: the request is about something not listed above.'
    };
}
