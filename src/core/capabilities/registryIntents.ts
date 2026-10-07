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
// Every `apis` id was chosen by hand from the index and is checked by a test
// to exist and be installable. `terms` widen the keyword search for the
// intent. `other` is how JEV says "none of these"; the host then falls back to
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
}

/** JEV's "none of these". Never mapped to APIs. */
export const OTHER_INTENT = 'other';

export const REGISTRY_INTENTS: RegistryIntent[] = [
    // --- Weather, places, travel ---
    { id: 'weather', criteria: 'Weather: current conditions, forecasts, rain, snow, temperature, wind.', terms: 'weather forecast', apis: ['visualcrossing.com:weather', 'interzoid.com:getweathercity'] },
    { id: 'geocoding', criteria: 'Turning an address into coordinates, or coordinates into an address.', terms: 'geocode address', apis: ['gov.bc.ca:geocoder'] },
    { id: 'routing', criteria: 'Directions, routes and travel time between places.', terms: 'routing directions', apis: ['graphhopper.com', 'tomtom.com:routing'] },
    { id: 'maps', criteria: 'Maps, map tiles and places of interest.', terms: 'maps', apis: ['tomtom.com:maps', 'amazonaws.com:location'] },
    { id: 'ip_geolocation', criteria: 'Where an IP address is located, or who owns it.', terms: 'ip geolocation', apis: ['abstractapi.com:geolocation', 'ip2location.io', 'bigdatacloud.net'] },
    { id: 'travel', criteria: 'Hotels, flights and trip planning.', terms: 'travel hotels flights', apis: ['impala.travel:hotels', 'amadeus.com:amadeus-travel-recommendations'] },
    { id: 'holidays', criteria: 'Public holidays and days off.', terms: 'holidays', apis: ['canada-holidays.ca'] },

    // --- Communication ---
    { id: 'sms', criteria: 'Sending or receiving text messages (SMS) to a phone.', terms: 'send sms text message', apis: ['nexmo.com:sms'] },
    { id: 'voice_calls', criteria: 'Making or receiving phone calls.', terms: 'voice calls', apis: ['nexmo.com:voice'] },
    { id: 'chat', criteria: 'Chat rooms and in-app messaging.', terms: 'chat messaging', apis: ['twilio.com:twilio_chat_v2'] },
    { id: 'email_send', criteria: 'Sending email.', terms: 'send email', apis: ['sendgrid.com', 'amazonaws.com:sesv2'] },
    { id: 'email_validation', criteria: 'Checking whether an email address is real, valid or disposable.', terms: 'email validation', apis: ['mailboxvalidator.com:validation', 'mailboxvalidator.com:disposable'] },
    { id: 'phone_lookup', criteria: 'Looking up or validating a phone number: carrier, country, line type.', terms: 'phone number validation', apis: ['nexmo.com:number-insight', 'interzoid.com:getglobalnumberinfo'] },

    // --- Money ---
    { id: 'currency', criteria: 'Currency exchange rates and converting between currencies.', terms: 'currency exchange rates', apis: ['exchangerate-api.com', 'interzoid.com:getcurrencyrate', 'interzoid.com:convertcurrency'] },
    { id: 'stocks', criteria: 'Stock and share prices, and financial market data.', terms: 'stock market data prices', apis: ['nfusionsolutions.biz'] },
    { id: 'payments', criteria: 'Taking or sending payments.', terms: 'payments', apis: ['klarna.com:payments', 'velopayments.com'] },
    { id: 'crypto_payments', criteria: 'Accepting cryptocurrency payments.', terms: 'cryptocurrency payments', apis: ['nowpayments.io'] },
    { id: 'banking', criteria: 'Bank accounts, balances and transactions.', terms: 'banking bank accounts', apis: ['codat.io:banking', 'openbankingproject.ch', 'xero.com:xero_bankfeeds'] },
    { id: 'accounting', criteria: 'Accounting, ledgers and bookkeeping data.', terms: 'accounting', apis: ['apideck.com:accounting', 'codat.io:accounting'] },

    // --- Commerce ---
    { id: 'products', criteria: 'A product catalogue or online store inventory.', terms: 'ecommerce products', apis: ['izettle.com:products'] },
    { id: 'shipping', criteria: 'Shipping labels and tracking parcels.', terms: 'shipping tracking', apis: ['shipengine.com', 'here.com:tracking'] },
    { id: 'barcode', criteria: 'Looking up a product barcode or UPC, or generating barcodes.', terms: 'barcode lookup', apis: ['go-upc.com', 'fungenerators.com:barcode'] },

    // --- Work and productivity ---
    { id: 'calendar', criteria: 'Calendars, events, meetings and scheduling.', terms: 'calendar events', apis: ['googleapis.com:calendar'] },
    { id: 'tasks', criteria: 'To-do lists and tasks.', terms: 'tasks', apis: ['googleapis.com:tasks', 'gsmtasks.com'] },
    { id: 'crm', criteria: 'Customer contacts, leads and deals (CRM).', terms: 'crm contacts', apis: ['apideck.com:crm', 'hubapi.com:crm'] },
    { id: 'support_tickets', criteria: 'Customer support tickets and help desks.', terms: 'customer support tickets', apis: ['apideck.com:customer-support'] },
    { id: 'forms', criteria: 'Forms and surveys, and their responses.', terms: 'forms surveys', apis: ['googleapis.com:forms', 'qualtrics.com'] },
    { id: 'file_storage', criteria: 'Storing and retrieving files.', terms: 'file storage', apis: ['apideck.com:file-storage', 'googleapis.com:storage', 'amazonaws.com:s3'] },
    { id: 'pdf', criteria: 'Creating, filling or converting PDF documents.', terms: 'pdf documents', apis: ['pdfgeneratorapi.com', 'api2pdf.com', 'pdfblocks.com'] },
    { id: 'code', criteria: 'Code repositories, issues and pull requests.', terms: 'github repositories issues', apis: ['github.com'] },
    { id: 'monitoring', criteria: 'Monitoring systems, metrics and alerts.', terms: 'monitoring alerts', apis: ['googleapis.com:monitoring', 'amazonaws.com:monitoring'] },
    { id: 'questions_answers', criteria: 'Programming questions and answers from a Q&A community.', terms: 'questions answers', apis: ['stackexchange.com'] },

    // --- Language and media understanding ---
    { id: 'translation', criteria: 'Translating text between languages.', terms: 'translate text', apis: ['googleapis.com:translate', 'amazonaws.com:translate'] },
    { id: 'speech_to_text', criteria: 'Transcribing speech or audio into text.', terms: 'speech to text', apis: ['googleapis.com:speech', 'rev.ai'] },
    { id: 'text_to_speech', criteria: 'Turning text into spoken audio.', terms: 'text to speech', apis: ['googleapis.com:texttospeech', 'amazonaws.com:polly'] },
    { id: 'sentiment', criteria: 'Sentiment, entities or meaning in a piece of text.', terms: 'sentiment text analysis', apis: ['googleapis.com:language', 'datumbox.com'] },
    { id: 'image_recognition', criteria: 'Recognising what is in an image, or reading text in it (OCR).', terms: 'image recognition ocr', apis: ['googleapis.com:vision', 'cloudmersive.com:ocr'] },

    // --- Information and entertainment ---
    { id: 'news', criteria: 'News articles and headlines.', terms: 'news articles', apis: ['nytimes.com:article_search', 'nytimes.com:timeswire'] },
    { id: 'movies', criteria: 'Films and movie reviews.', terms: 'movie reviews', apis: ['nytimes.com:movie_reviews'] },
    { id: 'books', criteria: 'Books, authors and bestseller lists.', terms: 'books', apis: ['googleapis.com:books', 'nytimes.com:books_api'] },
    { id: 'music', criteria: 'Music, songs, artists and playlists.', terms: 'music', apis: ['spotify.com'] },
    { id: 'video_games', criteria: 'Video games and game information.', terms: 'video games', apis: ['rawg.io'] },
    { id: 'sports', criteria: 'Sports scores, schedules and results.', terms: 'sports scores', apis: ['sportsdata.io:nfl-v3-scores', 'sportsdata.io:nba-v3-scores', 'sportsdata.io:mlb-v3-scores'] },
    { id: 'food', criteria: 'Recipes, food and nutrition facts.', terms: 'food nutrition recipes', apis: ['spoonacular.com', 'calorieninjas.com'] },
    { id: 'space', criteria: 'Space, astronomy, NASA imagery and near-Earth objects.', terms: 'space astronomy nasa', apis: ['nasa.gov:apod', 'neowsapp.com'] },
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
