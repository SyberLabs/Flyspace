# Speech field report

Scripted in-memory engine tasks are what was measured. `runFieldEvaluation` in `fieldHarness.ts` drives the four tasks below through the interaction engine: speech via a scripted adapter, push-to-talk, and the intent compiler; pointer via `pointerCreate`, `pointerConnect`, and `pointerDelete` (open-shell uses the same `openShell` mutator the shell panel calls). Counts are completion, errors, clarifications, and confirmations from those runs. They are not rates.

## Not measured

- Microphone latency: not measured. This environment has no live microphone capture.
- OpenAI Realtime latency: not measured. No `OPENAI_API_KEY` and no live Realtime session.
- Browser audio injection: not measured. No Playwright speech spec was executed and no page-level audio was injected.
- Human preference: not measured. The harness returns `not measured` until a person supplies a preference. None was supplied.

No latency percentiles were computed. `SpeechTimingRecorder` still refuses percentiles from zero live samples.

## Speech-disabled use

Speech-disabled use stays covered by a test that places a block without a speech adapter: `fieldHarness.test.ts` ("places a block with no speech adapter constructed") and `mutationInventory.test.ts` ("the speech-disabled path works with no speech adapter constructed"). Both call `pointerCreate` on the engine and assert the trace has no `speechObservationId`.

## Scripted results

A row is one in-memory run. `paraphrase-under-grammar` stays incomplete: the fixed grammar refuses "can you open research" and does not call a semantic compiler. The other scripted paths complete. Refusals and the scripted disconnect are errors. A hold (missing point, two analyst targets) is a clarification. "yeah" is an error, not a confirmation. Pointer delete commits on the click, so that path has no confirmation count.

| Task | Path | Variant | Compiler | Completed | Speech turns | Pointer acts | Errors | Clarifications | Confirmations | Latency |
|---|---|---|---|---|---|---|---|---|---|---|
| instantiate-place | pointer | sidebar-drop | — | yes | 0 | 1 | 0 | 0 | 0 | not measured |
| instantiate-place | speech | grammar | deterministic-only | yes | 1 | 1 | 0 | 0 | 0 | not measured |
| instantiate-place | speech | paraphrase | paraphrase | yes | 1 | 1 | 0 | 0 | 0 | not measured |
| instantiate-place | speech | paraphrase-then-grammar | deterministic-only | yes | 2 | 1 | 1 | 0 | 0 | not measured |
| instantiate-place | speech | no-point-then-point | deterministic-only | yes | 2 | 1 | 0 | 1 | 0 | not measured |
| connect-source-persona | pointer | wire-handle | — | yes | 0 | 1 | 0 | 0 | 0 | not measured |
| connect-source-persona | speech | grammar | deterministic-only | yes | 1 | 0 | 0 | 0 | 0 | not measured |
| connect-source-persona | speech | paraphrase | paraphrase | yes | 1 | 0 | 0 | 0 | 0 | not measured |
| connect-source-persona | speech | deixis | deterministic-only | yes | 1 | 1 | 0 | 0 | 0 | not measured |
| connect-source-persona | speech | disconnect-then-retry | deterministic-only | yes | 2 | 0 | 1 | 0 | 0 | not measured |
| connect-source-persona | speech | ambiguous-target | deterministic-only | yes | 2 | 0 | 0 | 1 | 0 | not measured |
| open-shell | pointer | shell-panel | — | yes | 0 | 1 | 0 | 0 | 0 | not measured |
| open-shell | speech | grammar | deterministic-only | yes | 1 | 0 | 0 | 0 | 0 | not measured |
| open-shell | speech | paraphrase | paraphrase | yes | 1 | 0 | 0 | 0 | 0 | not measured |
| open-shell | speech | paraphrase-under-grammar | deterministic-only | no | 1 | 0 | 1 | 0 | 0 | not measured |
| delete-with-confirmation | pointer | close-control | — | yes | 0 | 1 | 0 | 0 | 0 | not measured |
| delete-with-confirmation | speech | grammar | deterministic-only | yes | 2 | 1 | 0 | 0 | 1 | not measured |
| delete-with-confirmation | speech | named | deterministic-only | yes | 2 | 0 | 0 | 0 | 1 | not measured |
| delete-with-confirmation | speech | paraphrase | paraphrase | yes | 2 | 1 | 0 | 0 | 1 | not measured |
| delete-with-confirmation | speech | filler-then-confirm | deterministic-only | yes | 3 | 1 | 1 | 0 | 1 | not measured |
| delete-with-confirmation | speech | interrupted-then-retry | deterministic-only | yes | 3 | 1 | 0 | 0 | 1 | not measured |
