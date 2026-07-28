# Rel.AI MCP color system

`src/ui/colorTokens.mjs` is the build-time ESM owner of application colors. Dashboard, Electron setup/recovery, and OAuth surfaces consume generated CSS artifacts; runtime CommonJS modules do not import the manifest.

The system preserves the established blue-and-slate Rel.AI identity while enforcing WCAG 2.2 Level AA contrast, consistent operational meaning, and centralized maintenance.

## Generated artifacts

Run:

```powershell
npm run generate:color-tokens
```

This command generates:

- `src/ui/styles/color-tokens.css` for the dashboard;
- `electron/renderer/color-tokens.css` for setup and recovery renderers;
- `public/oauth.css` for OAuth authorization and error pages; and
- `docs/color-system-reference.svg` as the reviewable palette reference.

Generated files must not be edited directly. `test/color-system-unit.mjs` rejects stale output.

## Token layers

### Primitive values

Raw hexadecimal and alpha values exist only in `src/ui/colorTokens.mjs`. The palette intentionally contains only the shades currently required by the product. Do not add complete unused scales.

### Semantic roles

Components consume intent-based custom properties:

- `--ui-canvas` and `--ui-surface-*` for page and container depth;
- `--ui-text-*` for primary, secondary, tertiary, and disabled foregrounds;
- `--ui-border-*` for separators, component boundaries, and control boundaries;
- `--ui-action-primary*` for the primary action lifecycle;
- `--ui-focus-ring` and `--ui-selection-background` for interaction feedback;
- `--ui-status-*-foreground`, `-background`, and `-border` for operational state;
- `--ui-overlay-*`, `--ui-shadow-*`, and Electron decorative tokens for presentation effects.

The 0.23.0 hard cutover removes legacy aliases such as `--blue`, `--text-dim`, and `--line-soft`. All authored UI code uses semantic roles directly.

### Component tokens

A component-specific color is permitted only when the component has a genuine platform requirement that no semantic role describes. The Windows close-button hover is the current documented exception. Component names such as `--workspace-card-blue` or `--settings-warning-yellow` are prohibited.

## Canonical palette

| Role | Light | Dark |
|---|---|---|
| Canvas | `#EDF2F8` | `#070B13` |
| Surface primary | `#FFFFFF` | `#0D1626` |
| Surface secondary | `#F5F8FC` | `#131F34` |
| Surface raised | `#E8EEF6` | `#1C2A45` |
| Text primary | `#172033` | `#EDF3FC` |
| Text secondary | `#526078` | `#A7B4C9` |
| Text tertiary | `#647187` | `#8390A6` |
| Action primary | `#1769C2` | `#5AA6FF` |
| Action foreground | `#FFFFFF` | `#07111F` |
| Success foreground | `#137A4C` | `#4FE09A` |
| Warning foreground | `#7A4B00` | `#FFC24B` |
| Danger foreground | `#BF3149` | `#FF6F88` |

The complete values, including backgrounds, borders, hover states, overlays, scrollbars, and shadows, are defined in the manifest rather than duplicated here.

## Operational status rules

| State | Tone | Reason |
|---|---|---|
| Ready, available, connected, completed, passed | Success | Healthy or positive terminal result |
| Running, active, starting, stopping, connecting, reconnecting, open | Information | Normal progress or live activity |
| Waiting for approval, retrying, rate-limited, degraded, partial, incomplete | Warning | User action, impairment, or recoverable abnormal state |
| Failed, denied, blocked, invalid, unavailable | Danger | Blocking or terminal negative result |
| Idle, stopped, disconnected, cancelled, expired, unknown, inactive | Neutral | Non-alarming state or insufficient information |

Status must never be communicated through color alone. Compact status UI includes readable text or an accessible name. Toasts include a visible symbol and an announced severity label.

## Interaction rules

- Primary actions use explicit default, hover, active, foreground, and disabled values.
- Focus indicators must remain at least 3:1 against adjacent surfaces.
- Normal text must remain at least 4.5:1 against its actual background.
- Essential control boundaries must remain at least 3:1.
- Disabled controls use explicit foreground, background, and border tokens instead of reducing the entire component opacity.
- Alpha and `color-mix()` effects are allowed for non-essential decoration only. Essential text, state, focus, and control combinations use explicit testable values.
- Selected, hover, focus, active, and disabled states must remain independently distinguishable.

## Theme ownership

The dashboard supports persisted `system`, `dark`, and `light` preferences. Electron setup and recovery renderers follow the operating-system preference. Both surfaces resolve the same semantic roles through generated CSS.

OAuth remains intentionally minimal and dark. Its static stylesheet is generated from the canonical dark theme and served through `/public/oauth.css`; authorization code does not import the build-time manifest.

## Raw-color policy

Raw `#hex`, `rgb()`, and `rgba()` values are prohibited in:

- `src/ui/styles/app.css`;
- `electron/renderer/app.css`;
- `src/oauthProvider.js`;
- `src/http/auth.js`; and
- `electron/dashboard-window.js`.

The automated color-system test enforces this policy. Generated CSS and the canonical manifest are the only normal locations for raw values.

## Validation

Run:

```powershell
npm run test:colors
npm run test:all
```

The color test verifies:

- equal semantic coverage in light and dark themes;
- text, action, status, focus, and control-boundary contrast;
- absence of every removed compatibility alias;
- native ESM exports with no CommonJS bridge;
- deterministic dashboard, Electron, OAuth, and SVG output;
- absence of raw component colors;
- consistent running, waiting, success, and failure semantics;
- Electron token stylesheet ordering; and
- OAuth use of the shared manifest.

Before release, manually inspect the representative dashboard, Electron setup/recovery, and OAuth flows in light, dark, Windows high-contrast, and common color-vision-deficiency simulations. Review default, hover, focus, active, selected, disabled, loading, success, warning, danger, offline, and empty states at desktop and narrow viewport sizes.
