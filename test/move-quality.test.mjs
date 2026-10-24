import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMove, winChance } from '../move-quality.mjs';

test('keeping an advantage is judged against the current position, not an opponent blunder', () => {
    assert.equal(classifyMove({ before: 500, after: 500, bestmove: 'e2e4', uci: 'e2e4' }).grade, 'best');
    assert.equal(classifyMove({ before: 500, after: 0, bestmove: 'e2e4', uci: 'a2a3' }).grade, 'blunder');
    assert.equal(classifyMove({ before: 0, after: -10, bestmove: 'e2e4', uci: 'd2d4' }).grade, 'excellent');
    assert.equal(classifyMove({ before: 0, after: 100, bestmove: 'e2e4', uci: 'd2d4' }).grade, 'excellent', 'search noise is not a special brilliant move');
});
test('published loss bands distinguish accuracy and mistake severity', () => {
    const cp = probability => Math.log(probability / (1 - probability)) / 0.00368208;
    for (const [loss, grade] of [[.01,'excellent'],[.03,'good'],[.07,'inaccuracy'],[.15,'mistake'],[.25,'blunder']]) {
        assert.equal(classifyMove({ before: 0, after: cp(.5 - loss) }).grade, grade);
    }
    assert.ok(winChance(900) - winChance(600) < winChance(300) - winChance(0));
    assert.equal(classifyMove({ before: null, after: 10 }), null);
});
test('fast good moves have no special category, while true instant blunders still do', () => {
    assert.equal(classifyMove({ before: 0, after: 0, bestmove: 'e1h1', uci: 'e1g1', thinkTime: .1 }).slot, null);
    assert.equal(classifyMove({ before: 0, after: -400, thinkTime: .2 }).slot, 'misinput');
    assert.notEqual(classifyMove({ before: 0, after: -400, thinkTime: null }).slot, 'misinput');
    assert.equal(classifyMove({ before: 500, after: 0, thinkTime: 10 }).slot, 'threw_win');
});
