> **Status (2026-09-29):** historical — steps 2 and 6 name registration points that moved; normalizers register in `normalizerRegistry` in `src/core/gateway/ApiGateway.ts`, and block views register through `src/core/registry/ViewRegistry.tsx`, not a switch in `Canvas.tsx`. Current roadmap: APEX_PLAN.md.

[ ] 1. Create normalizer in `src/core/gateway/normalizers/{api}.ts`
    - Define raw response interface
    - Implement fetchFn (with logging)
    - Implement normalizeFn (convert to OmniItem[])
    
[ ] 2. Register with Gateway in `src/core/gateway/ApiGateway.ts`
    - Import normalizer
    - Add to apiTypeRegistry.set('{api}', normalizer)
[ ] 3. Create block adapter in `src/blocks/truth/{Api}Block.ts`
    - Create use{Api}Block hook
    - Convert OmniItems to display format
    - Sync with blockStore
[ ] 4. Register block in `src/core/registry/BlockRegistry.ts`
    - Add block_id, display_name, category, data_type
    - Set semantic_tags for Armory search
    
[ ] 5. Create view component in `src/components/blocks/{Api}View.tsx`
    - Status indicator
    - Refresh button
    - Card layout for items
[ ] 6. Wire rendering in `src/canvas/Canvas.tsx`
    - Import view + hook
    - Add case in BlockContent switch
    - Add {Api}BlockContent function