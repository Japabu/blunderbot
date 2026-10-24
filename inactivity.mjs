export class InactivityTimer {
    constructor(onIdle, timeoutMs = (Number(process.env.IDLE_TIMEOUT_MINUTES) || 5) * 60000) {
        this.onIdle = onIdle;
        this.timeoutMs = timeoutMs;
        this.running = false;
        this.timer = null;
    }

    start() {
        this.stop();
        this.running = true;
        this.activity(false);
    }

    activity(active) {
        if (!this.running) return;
        if (active) {
            clearTimeout(this.timer);
            this.timer = null;
        } else if (!this.timer) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.running = false;
                this.onIdle();
            }, this.timeoutMs);
            this.timer.unref?.();
        }
    }

    stop() {
        clearTimeout(this.timer);
        this.timer = null;
        this.running = false;
    }
}
