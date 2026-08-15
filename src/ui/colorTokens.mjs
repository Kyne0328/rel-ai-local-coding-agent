export const THEME_NAMES = Object.freeze(['dark', 'light']);

export const COLOR_THEMES = Object.freeze({
  dark: Object.freeze({
    canvas: '#0b100d', surfacePrimary: '#111713', surfaceSecondary: '#171e19', surfaceRaised: '#202822', surfaceInput: '#0e1410',
    textPrimary: '#f1f5f0', textSecondary: '#aab4ac', textTertiary: '#7e8981', textDisabled: '#8b958d',
    borderSubtle: '#273129', borderDefault: '#3a463d', borderControl: '#68756c',
    brandMarkSurface: '#111713', brandMarkBorder: 'rgba(216,255,116,.14)', brandMarkShadow: '0 .375rem 1rem rgba(0,0,0,.18)',
    actionPrimary: '#d8ff74', actionPrimaryHover: '#e2ff94', actionPrimaryActive: '#c5eb5f', actionPrimaryForeground: '#101612',
    focusRing: '#d8ff74', selectionBackground: '#273516',
    statusInfoForeground: '#5aa6ff', statusInfoBackground: '#142c48', statusInfoBorder: '#4f86bd',
    statusSuccessForeground: '#4fe09a', statusSuccessBackground: '#163236', statusSuccessBorder: '#3b9a6d',
    statusWarningForeground: '#ffc24b', statusWarningBackground: '#2f2e2b', statusWarningBorder: '#b38631',
    statusDangerForeground: '#ff6f88', statusDangerBackground: '#2f2234', statusDangerBorder: '#b94f67',
    statusNeutralForeground: '#aab4ac', statusNeutralBackground: '#202822', statusNeutralBorder: '#68756c',
    disabledBackground: '#202822', disabledBorder: '#3a463d',
    overlayModal: 'rgba(3,8,5,.55)', overlayDrawer: 'rgba(3,8,5,.32)',
    windowCloseForeground: '#ffffff', windowCloseBackground: '#c42b1c', switchThumb: '#ffffff', codeAccent: '#dce7d8',
    scrollbarTrack: 'rgba(11,16,13,.28)', scrollbarThumb: 'rgba(170,180,172,.42)', scrollbarThumbHover: 'rgba(170,180,172,.62)', scrollbarThumbActive: 'rgba(170,180,172,.78)', scrollbarCorner: '#0b100d',
    shadowTitlebar: '0 1px 12px rgba(0,0,0,.12)', shadowSidebar: '10px 0 40px rgba(0,0,0,.08)', shadowTopbar: '0 12px 36px rgba(0,0,0,.12)', shadowWindow: '0 18px 54px rgba(0,0,0,.28)', shadowPopover: '0 20px 60px rgba(0,0,0,.42)',
    electronSurfaceGradient: 'linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.008))',
    electronAppGradient: 'radial-gradient(900px 460px at 90% -10%, rgba(216,255,116,.10), transparent 60%), radial-gradient(700px 420px at -10% 110%, rgba(79,224,154,.035), transparent 58%)',
    electronElevation1: '0 1px 2px rgba(0,0,0,.45)', electronElevation2: '0 18px 44px -28px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.42)',
    electronGlowAccent: '0 0 0 1px rgba(216,255,116,.30), 0 0 24px -8px rgba(216,255,116,.44)', electronGlowSuccess: '0 0 14px -3px rgba(79,224,154,.72)',
    heroAccentSoft: 'rgba(216,255,116,.08)', heroAccentStrong: 'rgba(216,255,116,.22)', pulseRing: 'rgba(216,255,116,.26)'
  }),
  light: Object.freeze({
    canvas: '#edf2f8', surfacePrimary: '#ffffff', surfaceSecondary: '#f5f8fc', surfaceRaised: '#e8eef6', surfaceInput: '#f7f9fd',
    textPrimary: '#172033', textSecondary: '#526078', textTertiary: '#647187', textDisabled: '#5b697f',
    borderSubtle: '#dce3ec', borderDefault: '#c6d0dd', borderControl: '#7e8da2',
    brandMarkSurface: '#111713', brandMarkBorder: 'rgba(216,255,116,.14)', brandMarkShadow: '0 .375rem 1rem rgba(0,0,0,.18)',
    actionPrimary: '#657f00', actionPrimaryHover: '#5f7800', actionPrimaryActive: '#597200', actionPrimaryForeground: '#ffffff',
    focusRing: '#657f00', selectionBackground: '#eef5dc',
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
    electronAppGradient: 'radial-gradient(900px 460px at 90% -10%, rgba(101,127,0,.08), transparent 60%), radial-gradient(700px 420px at -10% 110%, rgba(23,105,194,.04), transparent 58%)',
    electronElevation1: '0 1px 2px rgba(29,43,68,.10)', electronElevation2: '0 18px 44px -30px rgba(29,43,68,.34), 0 1px 2px rgba(29,43,68,.10)',
    electronGlowAccent: '0 0 0 1px rgba(101,127,0,.18), 0 0 22px -10px rgba(101,127,0,.24)', electronGlowSuccess: '0 0 14px -5px rgba(19,122,76,.35)',
    heroAccentSoft: 'rgba(101,127,0,.07)', heroAccentStrong: 'rgba(101,127,0,.16)', pulseRing: 'rgba(101,127,0,.22)'
  })
});

function customPropertyName(key) {
  return `--ui-${String(key).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
}

function getTheme(name = 'dark') {
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
