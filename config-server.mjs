import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.CONTROL_PORT || 8769);
const origin = `http://127.0.0.1:${port}`;
const cache = new Map();
function run(command, args, input, limit = 20_000_000) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = [], err = [], bytes = 0;
        const timer = setTimeout(() => { child.kill(); reject(Error('The Pi took too long to respond.')); }, 45_000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.stdout.on('data', data => { bytes += data.length; if (bytes > limit) child.kill(); else out.push(data); });
        child.stderr.on('data', data => { if (Buffer.concat(err).length < 5000) err.push(data); });
        child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(out)) : reject(Error(Buffer.concat(out).toString() || Buffer.concat(err).toString() || 'Command failed')); });
        child.stdin.on('error', () => {}); child.stdin.end(input);
    });
}
async function remote(request) {
    const result = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', 'pi', 'docker exec -i blunderbot node control-cli.mjs'], JSON.stringify(request));
    const data = JSON.parse(result); if (data.error) throw Error(data.error); return data;
}
async function body(req, limit = 14_000_000) {
    let bytes = 0; const chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw Error('File is too large (maximum 10 MB).'); chunks.push(chunk); }
    return Buffer.concat(chunks);
}
function send(res, code, content, type = 'application/json') {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content));
    res.writeHead(code, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }); res.end(data);
}
const server = createServer(async (req, res) => {
    try {
        if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return send(res, 403, { error: 'Local requests only.' });
        const url = new URL(req.url, origin);
        if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
            const name = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }[url.pathname];
            return send(res, 200, await readFile(join(root, 'web', name)), name.endsWith('html') ? 'text/html; charset=utf-8' : name.endsWith('js') ? 'text/javascript' : 'text/css');
        }
        if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await remote({ action: 'snapshot', guild: url.searchParams.get('guild') || undefined }));
        if (req.method === 'GET' && url.pathname === '/api/audio') {
            const id = url.searchParams.get('id');
            if (!cache.has(id)) { const data = await remote({ action: 'audio', id }); if (cache.size >= 150) cache.delete(cache.keys().next().value); cache.set(id, Buffer.from(data.audio, 'base64')); }
            return send(res, 200, cache.get(id), 'audio/ogg');
        }
        if (req.method === 'POST' && url.pathname === '/api/save') {
            if (req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'Expected JSON' });
            const input = JSON.parse((await body(req, 200_000)).toString());
            return send(res, 200, await remote({ ...input, action: 'save' }));
        }
        if (req.method === 'POST' && url.pathname === '/api/upload') {
            const bytes = await body(req, 10_000_000);
            const folder = await mkdtemp(join(tmpdir(), 'blunderbot-sound-'));
            try {
                const source = join(folder, 'source'), target = join(folder, 'sound.ogg');
                await writeFile(source, bytes);
                await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-i', source, '-t', '30', '-vn', '-af', 'loudnorm=I=-12:TP=-1.5:LRA=11', '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2', target], '');
                const audio = (await readFile(target)).toString('base64');
                return send(res, 200, await remote({ action: 'upload', guild: url.searchParams.get('guild'), name: url.searchParams.get('name'), audio }));
            } finally { await rm(folder, { recursive: true, force: true }); }
        }
        send(res, 404, { error: 'Not found' });
    } catch (error) { let message = error.message; try { message = JSON.parse(message).error ?? message; } catch {} send(res, 400, { error: message.slice(0, 500) }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Blunderbot control room: ${origin}`));
