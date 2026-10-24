import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InactivityTimer } from '../inactivity.mjs';

test('five minutes without a game disconnects once even with repeated idle polls', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let disconnected = 0;
    const idle = new InactivityTimer(() => disconnected++);
    t.after(() => idle.stop());
    idle.start();
    for (let i = 0; i < 99; i++) {
        t.mock.timers.tick(3000);
        idle.activity(false);
    }
    assert.equal(disconnected, 0);
    t.mock.timers.tick(3000);
    assert.equal(disconnected, 1);
    idle.activity(false);
    t.mock.timers.tick(300000);
    assert.equal(disconnected, 1, 'late polling cannot restart an expired session');
});

test('an active game cancels the timeout, and game end starts a full new timeout', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let disconnected = 0;
    const idle = new InactivityTimer(() => disconnected++);
    t.after(() => idle.stop());
    idle.start();
    t.mock.timers.tick(299000);
    idle.activity(true);
    t.mock.timers.tick(3600000);
    assert.equal(disconnected, 0, 'a long game or long think must remain connected');
    idle.activity(false);
    t.mock.timers.tick(299999);
    assert.equal(disconnected, 0);
    t.mock.timers.tick(1);
    assert.equal(disconnected, 1);
});

test('stop cancels timeout and restart or a new command gets a fresh idle period', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let disconnected = 0;
    const idle = new InactivityTimer(() => disconnected++, 10000);
    t.after(() => idle.stop());
    idle.start(); t.mock.timers.tick(9000);
    idle.start(); t.mock.timers.tick(9000);
    assert.equal(disconnected, 0);
    idle.stop(); idle.activity(false); t.mock.timers.tick(60000);
    assert.equal(disconnected, 0);
    idle.start(); t.mock.timers.tick(10000);
    assert.equal(disconnected, 1);
});
