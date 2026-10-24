import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveReaction } from '../reaction.mjs';

test('normal best/excellent/good moves are quiet and speed does not reward a routine move', () => {
    for (const after of [0, -10, -40]) assert.equal(moveReaction({ before: 0, after, bestmove: 'e2e4', uci: 'e2e4', thinkTime: .1 }, () => true), null);
});
test('one meaningful reaction is chosen: verified find, own mistake, or a special event', () => {
    assert.equal(moveReaction({ before: 0, after: -400, flavor: 'attack_up', qualityUnknown: true }, () => true), null);
    assert.equal(moveReaction({ before: 0, after: -100, flavor: 'discovery' }, () => true), 'blunder_tiny');
    assert.equal(moveReaction({ before: 0, after: -400, flavor: 'attack_up' }, () => true), 'blunder_big');
    assert.equal(moveReaction({ before: 0, after: 0, flavor: 'discovery' }, () => true), 'discovery');
    assert.equal(moveReaction({ before: 0, after: 0, flavor: 'discovery', brilliant: {} }, () => true), 'brilliant_move');
    assert.equal(moveReaction({ before: 0, after: 0, great: {} }, () => true), 'great_move');
    assert.equal(moveReaction({ before: 0, after: -100, flavor: 'attack_up' }, slot => slot === 'attack_up'), 'attack_up');
    assert.equal(moveReaction({ before: null, after: 0, flavor: 'promotion' }, () => true), 'promotion');
});
