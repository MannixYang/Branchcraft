'use strict';
const MAX_TEXT = 4 * 1024 * 1024;
function text(value) {
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new TypeError('无效剪贴板文本');
  return value;
}
function registerTerminalClipboard({register, getWindow, electron = require('electron')}) {
  if (typeof register !== 'function' || typeof getWindow !== 'function') throw new TypeError('需要可信 IPC register 和 getWindow');
  const {clipboard, Menu} = electron;
  register('terminalClipboardRead', () => text(clipboard.readText()));
  register('terminalClipboardWrite', value => {clipboard.writeText(text(value));});
  register('terminalContextMenu', input => {
    if (!input || !Number.isSafeInteger(input.requestId) || input.requestId < 1 ||
        typeof input.canPaste !== 'boolean' || typeof input.canSelectAll !== 'boolean') throw new TypeError('无效终端菜单');
    const selection = text(input.selection), requestId = input.requestId;
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    const contents = win.webContents, frame = contents.mainFrame;
    const live = () => getWindow() === win && !win.isDestroyed() && !contents.isDestroyed() && contents.mainFrame === frame;
    const send = action => {if (live()) contents.send('terminalMenuAction', {action, requestId});};
    const menu = Menu.buildFromTemplate([
      {label:'复制', enabled:selection.length > 0, click:() => {if (live() && selection) clipboard.writeText(selection);}},
      {label:'粘贴', enabled:input.canPaste && clipboard.readText().length > 0, click:() => {if (input.canPaste) send('paste');}},
      {type:'separator'},
      {label:'全选', enabled:input.canSelectAll, click:() => {if (input.canSelectAll) send('selectAll');}}
    ]);
    menu.popup({window:win});
  });
}
module.exports = {registerTerminalClipboard};
