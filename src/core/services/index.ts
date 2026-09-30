// ============================================
// PROJECT OMNI: CORE SERVICES
// ============================================

export { LLMService, getLLMService, createLLMService } from './llm.service';
export type { LLMMessage, LLMOptions, LLMResponse } from './llm.service';

export { MindEngine, getMindEngine } from './mind.engine';
export type { ThinkResult } from './mind.engine';

export {
    getPersonaSystemPrompt,
    parseInsightsFromResponse,
    MIND_CONTEXT
} from './persona.prompts';
export type { BlockDataSummary, ExtractedInsight } from './persona.prompts';

export { captureShellSnapshot, formatSnapshotForLLM } from './shell.snapshot';
export type { ShellSnapshot, BlockSnapshotData } from './shell.snapshot';

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

