import { classifyMove } from './move-quality.mjs';

// Choose one reaction after analysis, rather than starting a board sound and
// cutting it off with a second engine sound a few milliseconds later.
export function moveReaction(info, enabled) {
    if (info.qualityUnknown) return null;
    if (info.brilliant && enabled('brilliant_move')) return 'brilliant_move';
    if (info.great && enabled('great_move')) return 'great_move';
    const quality = classifyMove(info);
    if (quality?.slot) return enabled(quality.slot) ? quality.slot : null;
    return info.flavor && enabled(info.flavor) ? info.flavor : null;
}

export function gameResultReaction({ result, status }, enabled) {
    if (result === 'win') return enabled('won_game') ? 'won_game' : null;
    if (result !== 'loss') return null;
    if (status === 'outoftime' && enabled('lost_on_time')) return 'lost_on_time';
    return enabled('lost_game') ? 'lost_game' : null;
}
