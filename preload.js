const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, d) => fn(d));

contextBridge.exposeInMainWorld('api', {
  newWindow: inv('win:new'),
  openChild: (kind, cfg, extra) => ipcRenderer.invoke('win:child', { kind, cfg, extra }),
  childInit: inv('win:childInit'),
  tileWindows: inv('win:tile'),
  focusSession: () => ipcRenderer.send('win:focusSession'),
  profiles: { list: inv('profiles:list'), save: inv('profiles:save'), remove: inv('profiles:delete'), export: inv('profiles:export'), import: inv('profiles:import') },
  hostkeys: { list: inv('hostkeys:list'), remove: inv('hostkeys:delete') },
  pickKeyFile: inv('dialog:keyfile'),
  connect: inv('ssh:connect'),
  disconnect: inv('ssh:disconnect'),
  exec: inv('ssh:exec'),
  shell: {
    open: inv('shell:open'),
    write: (id, data) => ipcRenderer.send('shell:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('shell:resize', { id, cols, rows }),
    close: (id) => ipcRenderer.send('shell:close', { id }),
  },
  local: { home: inv('local:home'), downloads: inv('local:downloads'), reveal: inv('local:reveal'), list: inv('local:list'), mkdir: inv('local:mkdir'), rename: inv('local:rename'), remove: inv('local:delete'), open: inv('local:open') },
  remote: { realpath: inv('sftp:realpath'), list: inv('sftp:list'), mkdir: inv('sftp:mkdir'), rename: inv('sftp:rename'), remove: inv('sftp:delete'), chmod: inv('sftp:chmod'), edit: inv('sftp:edit') },
  xfer: { start: inv('xfer:start'), cancel: (id) => ipcRenderer.send('xfer:cancel', id) },
  fwd: { start: inv('fwd:start'), stop: inv('fwd:stop') },
  replyPrompt: (id, value) => ipcRenderer.send('prompt:reply', { id, value }),
  pathForFile: (f) => webUtils.getPathForFile(f),
  onLog: on('log'), onState: on('ssh:state'), onPrompt: on('prompt'),
  onShellData: on('shell:data'), onShellExit: on('shell:exit'), onXfer: on('xfer:progress'),
});
