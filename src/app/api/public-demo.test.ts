import { describe, expect, it } from 'vitest';
import { POST as llm } from './llm/route';
import { POST as jevPersona } from './jev-persona/route';
import { POST as capabilityBroker } from './capability-broker/route';
import { POST as registryIntent } from './registry-intent/route';
import { GET as inferenceRuns } from './inference-runs/route';

// The deploy gate checks these answer 503: the public preview runs no backend.
describe('public preview stub routes', () => {
    it.each([
        ['/api/llm', llm, 'AI answers are unavailable in the public preview.'],
        ['/api/jev-persona', jevPersona, 'Persona suggestion is unavailable.'],
        ['/api/capability-broker', capabilityBroker, 'The capability broker is unavailable in the public preview.'],
        ['/api/registry-intent', registryIntent, 'Search routing is unavailable.'],
        ['/api/inference-runs', inferenceRuns, 'Inference history is unavailable in the public preview.']
    ])('%s answers 503', async (_path, route, error) => {
        const response = route();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error });
    });
});
