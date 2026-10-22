'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ID_PATTERN = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'i');
function defaultSpawn(...args) {
  let pty;
  try { pty = require('node-pty'); }
  catch (cause) { throw new Error('A working node-pty installation is required for a persistent PTY; no command-process fallback is provided.', { cause }); }
  return pty.spawn(...args);
}
class TerminalService {
  constructor({ spawn = defaultSpawn, onData = () => {}, onExit = () => {} } = {}) {
    for (const [name, fn] of Object.entries({ spawn, onData, onExit })) {
      if (typeof fn !== 'function') throw new TypeError(`${name} must be a function`);
    }
    this._spawn = spawn;
    this._onData = onData;
    this._onExit = onExit;
    this._session = null;
    this._disposed = false;
  }
  open(cwd) {
    if (this._disposed) throw new Error('Terminal service is disposed');
    if (this._session) throw new Error('A terminal session is already open; close it before changing cwd');
    if (typeof cwd !== 'string' || cwd.length > 32768 || cwd.includes('\0') || !path.isAbsolute(cwd)) throw new TypeError('cwd must be an absolute directory path');
    cwd = fs.realpathSync(cwd);
    if (!fs.statSync(cwd).isDirectory()) throw new TypeError('cwd must be a directory');
    const slash = String.fromCharCode(47);
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || `${slash}bin${slash}sh`);
    const args = process.platform === 'win32' ? ['-NoLogo'] : ['-l'];
    const cols = 80, rows = 24;
    const pty = this._spawn(shell, args, { name: 'xterm-256color', cwd, cols, rows, env: { ...process.env } });
    const session = { id: randomUUID(), cwd, pid: pty && pty.pid, cols, rows, pty, subscriptions: [] };
    this._session = session;
    try {
      for (const method of ['write', 'resize', 'kill', 'onData', 'onExit']) {
        if (!pty || typeof pty[method] !== 'function') throw new TypeError(`PTY must implement ${method}`);
      }
      session.subscriptions.push(pty.onData(data => {
        if (this._session === session) this._onData({ id: session.id, data });
      }));
      const exitSubscription = pty.onExit(event => {
        if (this._session !== session) return;
        this._session = null;
        this._unsubscribe(session);
        this._onExit({ id: session.id, exitCode: event.exitCode, signal: event.signal });
      });
      if (this._session === session) session.subscriptions.push(exitSubscription);
      else { exitSubscription?.dispose(); throw new Error('Shell exited during startup'); }
    } catch (error) {
      this._session = null;
      this._unsubscribe(session);
      try { if (pty && typeof pty.kill === 'function') pty.kill(); } catch {}
      throw error;
    }
    return { id: session.id, cwd, pid: session.pid, cols, rows };
  }
  write(id, data) {
    const session = this._getSession(id);
    if (typeof data !== 'string' || data.length > 65536) throw new TypeError('data must be a string of at most 65536 UTF-16 code units');
    session.pty.write(data);
  }
  resize(id, cols, rows) {
    const session = this._getSession(id);
    if (!Number.isInteger(cols) || cols < 1 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 300) throw new RangeError('Terminal size must be integer cols 1..500, rows 1..300');
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }
  close(id) {
    const session = this._getSession(id);
    this._session = null;
    this._unsubscribe(session);
    session.pty.kill();
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._session) this.close(this._session.id);
  }
  _getSession(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new TypeError('Invalid terminal session id');
    if (!this._session || this._session.id !== id) throw new Error('Unknown or closed terminal session');
    return this._session;
  }
  _unsubscribe(session) {
    for (const subscription of session.subscriptions.splice(0)) {
      try { if (subscription && typeof subscription.dispose === 'function') subscription.dispose(); } catch {}
    }
  }
}
module.exports = { TerminalService };
