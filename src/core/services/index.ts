// ============================================
// PROJECT OMNI: CORE SERVICES
// ============================================

export { LLMService, getLLMService, createLLMService } from './llm.service';
export type { LLMMessage, LLMOptions, LLMResponse } from './llm.service';

export {
    getPersonaSystemPrompt,
    buildAnalysisPrompt,
    parseInsightsFromResponse,
    MIND_CONTEXT
} from './persona.prompts';
export type { BlockDataSummary, ExtractedInsight } from './persona.prompts';

export {
    getInputPorts,
    getOutputPorts,
    createJsonOutputPort,
    createTextOutputPort,
    createMediaOutputPort,
    createAnyInputPort,
    createJsonInputPort,
    createTextInputPort
} from './port.service';

