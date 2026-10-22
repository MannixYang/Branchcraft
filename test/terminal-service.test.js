'use strict';
const { test } = require('node:test');
const assert = require('node:assert').strict;
const fs = require('node:fs');
const path = require('node:path');
const { TerminalService } = require(path.join(__dirname, '..', 'terminal-service'));
const cwd = path.resolve(__dirname, '..');
function fixture() {
  const calls = [], children = [], data = [], exits = [];
  const service = new TerminalService({ spawn(...args) {
    calls.push(args);
    const listeners = { data: new Set(), exit: new Set() };
    const child = {
      pid: 100 + children.length, writes: [], sizes: [], kills: 0, listeners,
      write(value) { this.writes.push(value); },
      resize(...size) { this.sizes.push(size); },
      kill() { this.kills++; this.emitExit({ exitCode: 0, signal: 0 }); },
      onData(fn) { listeners.data.add(fn); return { dispose: () => listeners.data.delete(fn) }; },
      onExit(fn) { listeners.exit.add(fn); return { dispose: () => listeners.exit.delete(fn) }; },
      emitData(value) { for (const fn of [...listeners.data]) fn(value); },
      emitExit(value) { for (const fn of [...listeners.exit]) fn(value); }
    };
    children.push(child); return child;
  }, onData: e => data.push(e), onExit: e => exits.push(e) });
  return { service, calls, children, data, exits };
}
test('open starts a PTY-contract shell bound to cwd with safe argv', () => {
  const f = fixture(), s = f.service.open(cwd);
  const [shell, args, options] = f.calls[0];
  assert.equal(shell, process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || path.posix.join(path.posix.sep, 'bin', 'sh')));
  assert.deepEqual(args, process.platform === 'win32' ? ['-NoLogo'] : ['-l']);
  assert.equal(options.cwd, fs.realpathSync(cwd)); assert.equal(options.name, 'xterm-256color');
  assert.notEqual(options.env, process.env);
  assert.deepEqual(s, { id: s.id, cwd: options.cwd, pid: 100, cols: 80, rows: 24 });
  assert.throws(() => f.service.open(cwd)); assert.equal(f.calls.length, 1); f.service.dispose();
});
test('persistent commands, partial input and control keys use one PTY', () => {
  const f = fixture(), s = f.service.open(cwd), pty = f.children[0];
  const input = ['cd ..\r', '$value = 42\r', 'echo $value\r', 'par', 'tial', '\x03', '\u001b[A', ''];
  input.forEach(value => f.service.write(s.id, value));
  pty.emitData('prompt> '); pty.emitData('42\r\n');
  assert.deepEqual(pty.writes, input); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.data, [{ id: s.id, data: 'prompt> ' }, { id: s.id, data: '42\r\n' }]); f.service.dispose();
});
test('resize forwards valid sizes and rejects invalid sizes', () => {
  const f = fixture(), s = f.service.open(cwd), pty = f.children[0];
  f.service.resize(s.id, 120, 40); f.service.resize(s.id, 1, 1); f.service.resize(s.id, 500, 300);
  for (const size of [[0, 24], [80, 0], [501, 24], [80, 301], [-1, 2], [1.2, 2], ['80', 24], [NaN, 24], [80, Infinity]]) assert.throws(() => f.service.resize(s.id, ...size), RangeError);
  assert.deepEqual(pty.sizes, [[120, 40], [1, 1], [500, 300]]); f.service.dispose();
});
test('input length and type limits do not forward invalid data', () => {
  const f = fixture(), s = f.service.open(cwd);
  f.service.write(s.id, 'x'.repeat(65536));
  for (const value of ['x'.repeat(65537), null, {}, Buffer.from('x'), 1]) assert.throws(() => f.service.write(s.id, value), TypeError);
  assert.equal(f.children[0].writes.length, 1); f.service.dispose();
});
test('close kills, detaches listeners and rejects old ids after reopening', () => {
  const f = fixture(), first = f.service.open(cwd), old = f.children[0];
  f.service.close(first.id); assert.equal(old.kills, 1);
  assert.equal(old.listeners.data.size, 0); assert.equal(old.listeners.exit.size, 0);
  const second = f.service.open(path.dirname(cwd)); assert.notEqual(first.id, second.id);
  for (const op of [() => f.service.write(first.id, 'x'), () => f.service.resize(first.id, 80, 24), () => f.service.close(first.id)]) assert.throws(op);
  old.emitData('stale'); old.emitExit({ exitCode: 9 });
  assert.deepEqual(f.data, []); assert.deepEqual(f.exits, []);
  f.service.write(second.id, 'live'); assert.deepEqual(f.children[1].writes, ['live']); f.service.dispose();
});
test('native exit reports once, invalidates id and allows reopening', () => {
  const f = fixture(), first = f.service.open(cwd), pty = f.children[0];
  pty.emitExit({ exitCode: 7, signal: 0 }); pty.emitExit({ exitCode: 8, signal: 1 });
  assert.deepEqual(f.exits, [{ id: first.id, exitCode: 7, signal: 0 }]); assert.equal(pty.kills, 0);
  assert.throws(() => f.service.write(first.id, 'x')); assert.notEqual(f.service.open(cwd).id, first.id); f.service.dispose();
});
test('dispose kills exactly once and prevents reopening', () => {
  const f = fixture(), s = f.service.open(cwd); f.service.dispose(); f.service.dispose();
  assert.equal(f.children[0].kills, 1); assert.throws(() => f.service.open(cwd)); assert.throws(() => f.service.write(s.id, 'x'));
  const empty = fixture(); empty.service.dispose(); empty.service.dispose();
});
test('malformed or foreign ids never reach the child', () => {
  const f = fixture(), s = f.service.open(cwd);
  for (const id of [null, undefined, 1, {}, '', 'x'.repeat(100000), `${s.id}x`, '00000000-0000-4000-8000-000000000000']) {
    assert.throws(() => f.service.write(id, 'x')); assert.throws(() => f.service.resize(id, 80, 24)); assert.throws(() => f.service.close(id));
  }
  assert.deepEqual(f.children[0].writes, []); assert.equal(f.children[0].kills, 0); f.service.dispose();
});
test('invalid cwd never spawns and callbacks are validated', () => {
  const f = fixture();
  for (const dir of [null, '', '.', 'a\0b', __filename, path.join(cwd, 'not-present-terminal-test-directory')]) assert.throws(() => f.service.open(dir));
  assert.equal(f.calls.length, 0);
  for (const name of ['spawn', 'onData', 'onExit']) assert.throws(() => new TerminalService({ [name]: 1 }), TypeError);
});

test('synchronous exit during registration cleans subscriptions and allows reopening', () => {
  const exits = [], subscriptions = { data: 0, exit: 0 }; let spawns = 0, kills = 0;
  const service = new TerminalService({
    spawn() {
      const synchronous = spawns++ === 0;
      return { pid: 321, write() {}, resize() {}, kill() { kills++; },
        onData() { subscriptions.data++; return { dispose() { subscriptions.data--; } }; },
        onExit(fn) { subscriptions.exit++; if (synchronous) fn({ exitCode: 1, signal: 0 });
          return { dispose() { subscriptions.exit--; } }; }
      };
    }, onExit: event => exits.push(event)
  });
  assert.throws(() => service.open(cwd), /Shell exited during startup/);
  assert.deepEqual(subscriptions, { data: 0, exit: 0 });
  assert.equal(exits.length, 1); assert.equal(kills, 1);
  assert.throws(() => service.write(exits[0].id, 'stale'));
  const live = service.open(cwd); assert.notEqual(live.id, exits[0].id);
  service.write(live.id, 'live'); service.dispose();
  assert.deepEqual(subscriptions, { data: 0, exit: 0 }); assert.equal(kills, 2);
});
