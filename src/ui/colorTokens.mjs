export const THEME_NAMES = Object.freeze(['dark', 'light']);

export const COLOR_THEMES = Object.freeze({
  dark: Object.freeze({
    canvas: '#070b13', surfacePrimary: '#0d1626', surfaceSecondary: '#131f34', surfaceRaised: '#1c2a45', surfaceInput: '#0a111d',
    textPrimary: '#edf3fc', textSecondary: '#a7b4c9', textTertiary: '#8390a6', textDisabled: '#8c99ae',
    borderSubtle: '#26334a', borderDefault: '#3a4860', borderControl: '#6a7890',
    actionPrimary: '#5aa6ff', actionPrimaryHover: '#74b5ff', actionPrimaryActive: '#3d92f2', actionPrimaryForeground: '#07111f',
    focusRing: '#5aa6ff', selectionBackground: '#142c48',
    statusInfoForeground: '#5aa6ff', statusInfoBackground: '#142c48', statusInfoBorder: '#4f86bd',
    statusSuccessForeground: '#4fe09a', statusSuccessBackground: '#163236', statusSuccessBorder: '#3b9a6d',
    statusWarningForeground: '#ffc24b', statusWarningBackground: '#2f2e2b', statusWarningBorder: '#b38631',
    statusDangerForeground: '#ff6f88', statusDangerBackground: '#2f2234', statusDangerBorder: '#b94f67',
    statusNeutralForeground: '#a7b4c9', statusNeutralBackground: '#1c2a45', statusNeutralBorder: '#6a7890',
    disabledBackground: '#1c2a45', disabledBorder: '#3a4860',
    overlayModal: 'rgba(3,7,14,.55)', overlayDrawer: 'rgba(3,7,14,.32)',
    windowCloseForeground: '#ffffff', windowCloseBackground: '#c42b1c', switchThumb: '#ffffff', codeAccent: '#cfe0ff',
    scrollbarTrack: 'rgba(7,11,19,.28)', scrollbarThumb: 'rgba(167,180,201,.42)', scrollbarThumbHover: 'rgba(167,180,201,.62)', scrollbarThumbActive: 'rgba(167,180,201,.78)', scrollbarCorner: '#070b13',
    shadowTitlebar: '0 1px 12px rgba(0,0,0,.12)', shadowSidebar: '10px 0 40px rgba(0,0,0,.08)', shadowTopbar: '0 12px 36px rgba(0,0,0,.12)', shadowWindow: '0 18px 54px rgba(0,0,0,.28)', shadowPopover: '0 20px 60px rgba(0,0,0,.42)',
    electronSurfaceGradient: 'linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.008))',
    electronAppGradient: 'radial-gradient(900px 460px at 90% -10%, rgba(90,166,255,.11), transparent 60%), radial-gradient(700px 420px at -10% 110%, rgba(79,224,154,.06), transparent 58%)',
    electronElevation1: '0 1px 2px rgba(0,0,0,.45)', electronElevation2: '0 18px 44px -28px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.42)',
    electronGlowAccent: '0 0 0 1px rgba(90,166,255,.32), 0 0 24px -8px rgba(90,166,255,.55)', electronGlowSuccess: '0 0 14px -3px rgba(79,224,154,.72)',
    heroAccentSoft: 'rgba(90,166,255,.09)', heroAccentStrong: 'rgba(90,166,255,.24)', pulseRing: 'rgba(90,166,255,.28)'
  }),
  light: Object.freeze({
    canvas: '#edf2f8', surfacePrimary: '#ffffff', surfaceSecondary: '#f5f8fc', surfaceRaised: '#e8eef6', surfaceInput: '#f7f9fd',
    textPrimary: '#172033', textSecondary: '#526078', textTertiary: '#647187', textDisabled: '#5b697f',
    borderSubtle: '#dce3ec', borderDefault: '#c6d0dd', borderControl: '#7e8da2',
    actionPrimary: '#1769c2', actionPrimaryHover: '#145ca8', actionPrimaryActive: '#104c8c', actionPrimaryForeground: '#ffffff',
    focusRing: '#1769c2', selectionBackground: '#e5f0fb',
    statusInfoForeground: '#1769c2', statusInfoBackground: '#e5f0fb', statusInfoBorder: '#6a94bd',
    statusSuccessForeground: '#137a4c', statusSuccessBackground: '#e5f0eb', statusSuccessBorder: '#5c9276',
    statusWarningForeground: '#7a4b00', statusWarningBackground: '#fff3d6', statusWarningBorder: '#aa7925',
    statusDangerForeground: '#bf3149', statusDangerBackground: '#f8e8eb', statusDangerBorder: '#c15b6d',
    statusNeutralForeground: '#526078', statusNeutralBackground: '#e8eef6', statusNeutralBorder: '#7e8da2',
    disabledBackground: '#e8eef6', disabledBorder: '#c6d0dd',
    overlayModal: 'rgba(3,7,14,.45)', overlayDrawer: 'rgba(3,7,14,.24)',
    windowCloseForeground: '#ffffff', windowCloseBackground: '#c42b1c', switchThumb: '#ffffff', codeAccent: '#1769c2',
    scrollbarTrack: 'rgba(23,32,51,.06)', scrollbarThumb: 'rgba(82,96,120,.38)', scrollbarThumbHover: 'rgba(82,96,120,.58)', scrollbarThumbActive: 'rgba(82,96,120,.72)', scrollbarCorner: '#edf2f8',
    shadowTitlebar: '0 1px 12px rgba(38,52,76,.10)', shadowSidebar: '10px 0 40px rgba(38,52,76,.08)', shadowTopbar: '0 12px 36px rgba(38,52,76,.10)', shadowWindow: '0 18px 54px rgba(38,52,76,.14)', shadowPopover: '0 20px 60px rgba(38,52,76,.20)',
    electronSurfaceGradient: 'linear-gradient(180deg, rgba(255,255,255,.98), rgba(247,249,253,.98))',
    electronAppGradient: 'radial-gradient(900px 460px at 90% -10%, rgba(23,105,194,.09), transparent 60%), radial-gradient(700px 420px at -10% 110%, rgba(19,122,76,.05), transparent 58%)',
    electronElevation1: '0 1px 2px rgba(29,43,68,.10)', electronElevation2: '0 18px 44px -30px rgba(29,43,68,.34), 0 1px 2px rgba(29,43,68,.10)',
    electronGlowAccent: '0 0 0 1px rgba(23,105,194,.18), 0 0 22px -10px rgba(23,105,194,.25)', electronGlowSuccess: '0 0 14px -5px rgba(19,122,76,.35)',
    heroAccentSoft: 'rgba(23,105,194,.08)', heroAccentStrong: 'rgba(23,105,194,.18)', pulseRing: 'rgba(23,105,194,.24)'
  })
});

export function customPropertyName(key) {
  return `--ui-${String(key).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
}

export function getTheme(name = 'dark') {
  if (!Object.hasOwn(COLOR_THEMES, name)) throw new Error(`Unknown color theme: ${name}`);
  return COLOR_THEMES[name];
}

export function semanticEntries(name) {
  return Object.entries(getTheme(name)).map(([key, value]) => [customPropertyName(key), value]);
}

function renderDeclarations(name) {
  return semanticEntries(name).map(([property, value]) => `  ${property}: ${value};`).join('\n');
}

export function renderDashboardTokenCss() {
  return `/* Generated by scripts/generate-color-tokens.mjs. Do not edit directly. */\n:root {\n  color-scheme: dark;\n${renderDeclarations('dark')}\n}\n\n:root[data-theme="light"] {\n  color-scheme: light;\n${renderDeclarations('light')}\n}\n`;
}

export function renderElectronTokenCss() {
  return `/* Generated by scripts/generate-color-tokens.mjs. Do not edit directly. */\n:root {\n  color-scheme: dark;\n${renderDeclarations('dark')}\n}\n\n@media (prefers-color-scheme: light) {\n  :root {\n    color-scheme: light;\n${renderDeclarations('light').split('\n').map(line => `  ${line}`).join('\n')}\n  }\n}\n`;
}

export function renderOauthCss() {
  const theme = getTheme('dark');
  return `/* Generated by scripts/generate-color-tokens.mjs. Do not edit directly. */\n.oauth-page{box-sizing:border-box;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:20px;background:${theme.canvas};color:${theme.textPrimary};font-family:system-ui,sans-serif}.oauth-page *,.oauth-page *::before,.oauth-page *::after{box-sizing:border-box}.oauth-card{width:min(100%,360px);padding:28px;border:1px solid ${theme.borderDefault};border-radius:14px;background:${theme.surfacePrimary};box-shadow:${theme.shadowPopover}}.oauth-page h1,.oauth-page h2{margin:0 0 6px;font-size:18px}.oauth-page p{margin:0 0 18px;color:${theme.textSecondary};font-size:13px;line-height:1.5}.oauth-page label{display:block;margin-bottom:6px;color:${theme.textSecondary};font-size:11px;letter-spacing:.05em;text-transform:uppercase}.oauth-page input[type=password]{width:100%;padding:10px;border:1px solid ${theme.borderControl};border-radius:8px;background:${theme.surfaceInput};color:${theme.textPrimary};font-size:14px}.oauth-page input[type=password]:focus-visible,.oauth-page button:focus-visible{outline:2px solid ${theme.focusRing};outline-offset:2px}.oauth-page button{width:100%;margin-top:16px;padding:11px;border:1px solid ${theme.actionPrimary};border-radius:8px;background:${theme.actionPrimary};color:${theme.actionPrimaryForeground};font-size:14px;font-weight:600;cursor:pointer}.oauth-page button:hover{border-color:${theme.actionPrimaryHover};background:${theme.actionPrimaryHover}}.oauth-page button:active{border-color:${theme.actionPrimaryActive};background:${theme.actionPrimaryActive}}.oauth-error{margin-bottom:14px;padding:9px 11px;border:1px solid ${theme.statusDangerBorder};border-radius:8px;background:${theme.statusDangerBackground};color:${theme.statusDangerForeground};font-size:12px}.oauth-client{margin-top:14px;color:${theme.textSecondary};font-size:12px;overflow-wrap:anywhere}.oauth-error-page{align-items:flex-start;padding-top:48px}.oauth-error-card{width:min(100%,680px)}.oauth-error-card h2{margin-bottom:10px;font-size:20px}.oauth-error-card p{margin:0}\n`;
}

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value));
  if (!match) throw new Error(`Contrast checks require a six-digit hex color: ${value}`);
  const integer = Number.parseInt(match[1], 16);
  return [(integer >> 16) & 255, (integer >> 8) & 255, integer & 255];
}

function relativeLuminance(value) {
  const channels = parseHex(value).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

export function renderColorReferenceSvg() {
  const roles = [
    ['Canvas', 'canvas'], ['Surface', 'surfacePrimary'], ['Surface secondary', 'surfaceSecondary'],
    ['Text primary', 'textPrimary'], ['Text secondary', 'textSecondary'], ['Text tertiary', 'textTertiary'],
    ['Action primary', 'actionPrimary'], ['Information', 'statusInfoForeground'], ['Success', 'statusSuccessForeground'],
    ['Warning', 'statusWarningForeground'], ['Danger', 'statusDangerForeground']
  ];
  const columns = THEME_NAMES.map((name, columnIndex) => {
    const theme = getTheme(name);
    const x = columnIndex === 0 ? 40 : 620;
    const heading = name === 'dark' ? 'Dark theme' : 'Light theme';
    const foreground = name === 'dark' ? '#ffffff' : '#07111f';
    const opposite = name === 'dark' ? '#07111f' : '#ffffff';
    const cards = roles.map(([label, key], rowIndex) => {
      const y = 92 + rowIndex * 62;
      const fill = theme[key];
      const text = contrastRatio(fill, '#07111f') >= 4.5 ? '#07111f' : opposite;
      return `<g><rect x="${x}" y="${y}" width="520" height="48" rx="8" fill="${fill}" stroke="${theme.borderDefault}"/><text x="${x + 16}" y="${y + 21}" fill="${text}" font-size="14" font-weight="700">${escapeXml(label)}</text><text x="${x + 16}" y="${y + 38}" fill="${text}" font-size="11">${fill}</text></g>`;
    }).join('');
    return `<text x="${x}" y="52" fill="${foreground}" font-size="24" font-weight="700">${heading}</text>${cards}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820" role="img" aria-labelledby="title desc"><title id="title">Rel.AI MCP color-system reference</title><desc id="desc">Canonical light and dark semantic color tokens generated from src/ui/colorTokens.mjs.</desc><rect width="1200" height="820" fill="#111827"/><g font-family="Segoe UI,Arial,sans-serif">${columns}</g></svg>\n`;
}
