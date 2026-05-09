export function Skeleton(type = 'line', { width, height } = {}) {
  const el = document.createElement('div');
  const base = 'background:linear-gradient(90deg,var(--surface),var(--surface-2,#111827),var(--surface));background-size:200% 100%;border-radius:';
  const types = { line: base + '4px;height:14px;', block: base + '8px;', circle: base + '999px;' };
  el.style.cssText = (types[type] || types.line) + (width ? `width:${width};` : 'width:100%;') + (height ? `height:${height};` : '');
  return el;
}
