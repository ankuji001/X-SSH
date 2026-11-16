/* Inline SVG icon set (stroke icons, 24x24). Use ICON('name') or <i data-icon="name"></i>. */
'use strict';
const ICON_PATHS = {
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  transfer: '<path d="M7 3v14M3 7l4-4 4 4M17 21V7M13 17l4 4 4-4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M18 5l2 2"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chevUp: '<path d="m18 15-6-6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  open: '<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
};
function ICON(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((i) => { i.outerHTML = ICON(i.dataset.icon); });
}

// File-type icon: coloured by category, shows extension badge.
const FILE_KINDS = [
  ['archive', '#fab387', /\.(zip|tar|tgz|gz|bz2|xz|7z|rar|zst|deb|rpm|iso)$/i],
  ['image', '#cba6f7', /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i],
  ['code', '#a6e3a1', /\.(js|ts|jsx|tsx|py|sh|bash|zsh|c|h|cpp|go|rs|rb|php|java|kt|lua|pl|html|css|scss)$/i],
  ['config', '#94e2d5', /(\.(json|ya?ml|toml|ini|conf|cfg|env|xml)|^\.?[a-z]*rc)$/i],
  ['doc', '#89b4fa', /\.(txt|md|pdf|log|csv|docx?|xlsx?|odt|rtf)$/i],
  ['media', '#f38ba8', /\.(mp[34]|mkv|wav|flac|ogg|webm|avi|mov)$/i],
  ['key', '#f9e2af', /(\.(pem|key|pub|crt|cer|p12)|^id_[a-z0-9]+)$/i],
];
function fileIcon(name, isDir) {
  if (isDir) return `<span class="ficon dir">${ICON('folder')}</span>`;
  const k = FILE_KINDS.find(([, , re]) => re.test(name));
  return `<span class="ficon" style="--fc:${k ? k[1] : '#9399b2'}">${ICON('file')}</span>`;
}
