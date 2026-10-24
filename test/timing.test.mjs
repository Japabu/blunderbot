import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingPlan, validateTiming } from '../timing.mjs';

test('bullet waits three seconds, blitz five, using the actual speed including increments', () => {
    assert.deepEqual(waitingPlan(60, 'bullet'), [{ seconds: 3, waiting: true }]);
    assert.deepEqual(waitingPlan(180, 'blitz'), [{ seconds: 5, waiting: true }]);
    assert.deepEqual(waitingPlan(120, 'blitz'), [{ seconds: 5, waiting: true }]);
    assert.deepEqual(waitingPlan(15, 'ultraBullet'), [{ seconds: 3, waiting: true }]);
    assert.deepEqual(waitingPlan(180, 'blitz', { bullet: 4, blitz: 6 }), [{ seconds: 6, waiting: true }]);
    assert.deepEqual(waitingPlan(0, 'blitz'), []);
    assert.equal(waitingPlan(600, 'rapid').at(-1).seconds, 90);
});
test('invalid waiting times are rejected rather than silently replaced', () => {
    for (const value of [{ bullet: 0, blitz: 3 }, { bullet: 2, blitz: NaN }, { bullet: '2', blitz: 3 }, { bullet: 2 }]) {
        assert.throws(() => validateTiming(value), /Waiting times/);
    }
});
