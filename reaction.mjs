import { classifyMove } from './move-quality.mjs';

// Choose one reaction after analysis, rather than starting a board sound and
// cutting it off with a second engine sound a few milliseconds later.
export function moveReaction(info, enabled) {
    if (info.brilliant && enabled('brilliant_move')) return 'brilliant_move';
    if (info.great && enabled('great_move')) return 'great_move';
    const quality = classifyMove(info);
    if (quality?.slot && enabled(quality.slot)) return quality.slot;
    return info.flavor && enabled(info.flavor) ? info.flavor : null;
}
