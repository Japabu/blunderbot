import { VoiceConnectionDisconnectReason, VoiceConnectionStatus } from '@discordjs/voice';

const watched = new WeakMap();

// joinVoiceChannel can return an existing connection when /lichess is used again.
export function watchVoiceConnection(connection, { onRecovered = () => {}, log = console.log } = {}) {
    if (watched.has(connection)) return watched.get(connection);
    let lastProgress = Date.now();
    let retryAt = 0;
    let attempts = 0;
    let wasReady = connection.state.status === VoiceConnectionStatus.Ready;

    const changed = (oldState, newState) => {
        if (oldState.status !== newState.status) {
            lastProgress = Date.now();
            const details = newState.status === VoiceConnectionStatus.Disconnected
                ? ` (reason ${newState.reason}, close code ${newState.closeCode ?? '?'})` : '';
            log(`Voice connection: ${oldState.status} -> ${newState.status}${details}`);
        }
        if (newState.status === VoiceConnectionStatus.Destroyed) return stop();
        if (newState.status === VoiceConnectionStatus.Ready && oldState.status !== newState.status) {
            const recovered = wasReady || attempts > 0;
            wasReady = true;
            attempts = 0;
            retryAt = 0;
            if (recovered) onRecovered();
        }
    };
    const error = error => console.error('Voice connection error:', error);
    const timer = setInterval(() => {
        const { status, reason } = connection.state;
        if (status === VoiceConnectionStatus.Destroyed) return stop();
        if (status === VoiceConnectionStatus.Ready
            || (status === VoiceConnectionStatus.Disconnected && reason === VoiceConnectionDisconnectReason.Manual)) return;
        const now = Date.now();
        const timeout = status === VoiceConnectionStatus.Disconnected ? 5000 : 20000;
        if (now - lastProgress < timeout || now < retryAt) return;
        retryAt = now + Math.min(5000 * 2 ** Math.min(attempts, 3), 30000);
        attempts++;
        log(`Recovering Discord voice: ${status}, attempt ${attempts}`);
        try { connection.rejoin(); }
        catch (cause) { error(cause); }
    }, 5000);
    const ping = setInterval(() => {
        log(`[timing] voice ping: state ${connection.state.status}, websocket ${connection.ping.ws ?? '?'} ms, udp ${connection.ping.udp ?? '?'} ms`);
    }, 60000);
    timer.unref?.();
    ping.unref?.();
    function stop() {
        clearInterval(timer);
        clearInterval(ping);
        connection.off('stateChange', changed);
        connection.off('error', error);
        watched.delete(connection);
    }
    connection.on('stateChange', changed);
    connection.on('error', error);
    watched.set(connection, stop);
    return stop;
}
