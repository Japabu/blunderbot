import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { VoiceConnectionDisconnectReason as Reason } from '@discordjs/voice';
import { watchVoiceConnection } from '../voice.mjs';

class Connection extends EventEmitter {
    state = { status: 'ready' };
    ping = { ws: 20 };
    rejoins = 0;
    succeeds = true;
    change(status, details = {}) {
        const previous = this.state;
        this.state = { status, ...details };
        this.emit('stateChange', previous, this.state);
    }
    rejoin() {
        this.rejoins++;
        if (this.succeeds) this.change('signalling');
        else this.change('disconnected', { reason: Reason.AdapterUnavailable });
        return this.succeeds;
    }
}

test('a dropped voice connection recovers, retries a stuck handshake, and refreshes its cue', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const connection = new Connection();
    let recovered = 0;
    const stop = watchVoiceConnection(connection, { onRecovered: () => recovered++, log() {} });
    t.after(stop);
    connection.change('disconnected', { reason: Reason.WebSocketClose, closeCode: 4014 });
    t.mock.timers.tick(4999); assert.equal(connection.rejoins, 0);
    t.mock.timers.tick(1); assert.equal(connection.rejoins, 1);
    connection.change('connecting');
    t.mock.timers.tick(15000); assert.equal(connection.rejoins, 1);
    t.mock.timers.tick(5000); assert.equal(connection.rejoins, 2);
    connection.change('ready');
    assert.equal(recovered, 1);
    t.mock.timers.tick(60000); assert.equal(connection.rejoins, 2);
});

test('automatic reconnects refresh the cue and repeated /lichess calls add no duplicate watchers', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const connection = new Connection();
    const messages = [];
    let recovered = 0;
    const stop = watchVoiceConnection(connection, { onRecovered: () => recovered++, log: line => messages.push(line) });
    t.after(stop);
    assert.equal(watchVoiceConnection(connection), stop);
    assert.equal(connection.listenerCount('stateChange'), 1);
    connection.change('connecting');
    connection.change('ready');
    assert.equal(recovered, 1);
    t.mock.timers.tick(60000);
    assert.equal(messages.filter(line => line.includes('voice ping')).length, 1);
    assert.equal(connection.rejoins, 0);
    connection.change('destroyed');
    const count = messages.length;
    t.mock.timers.tick(120000);
    assert.equal(messages.length, count);
    assert.equal(connection.listenerCount('stateChange'), 0);
});

test('an unavailable adapter is retried with backoff; intentional disconnection stays stopped', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const connection = new Connection();
    connection.succeeds = false;
    const stop = watchVoiceConnection(connection, { log() {} });
    t.after(stop);
    connection.change('disconnected', { reason: Reason.AdapterUnavailable });
    t.mock.timers.tick(5000); assert.equal(connection.rejoins, 1);
    t.mock.timers.tick(5000); assert.equal(connection.rejoins, 2);
    t.mock.timers.tick(5000); assert.equal(connection.rejoins, 2);
    t.mock.timers.tick(5000); assert.equal(connection.rejoins, 3);
    connection.change('disconnected', { reason: Reason.Manual });
    t.mock.timers.tick(120000); assert.equal(connection.rejoins, 3);
});
