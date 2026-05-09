// Card with optional head, body, foot slots
export function Card({ title, titleAction, children, footer } = {}) {
  const el = document.createElement('div');
  el.className = 'card';

  if (title) {
    const head = document.createElement('div');
    head.className = 'card-head';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    head.appendChild(h3);
    if (titleAction) head.appendChild(titleAction);
    el.appendChild(head);
  }

  const body = document.createElement('div');
  body.className = 'card-body';
  if (children) {
    if (typeof children === 'string') body.innerHTML = children;
    else if (children instanceof Node) body.appendChild(children);
  }
  el.appendChild(body);

  if (footer) {
    const foot = document.createElement('div');
    foot.className = 'card-foot';
    if (typeof footer === 'string') foot.textContent = footer;
    else foot.appendChild(footer);
    el.appendChild(foot);
  }

  el.getBody = () => body;
  return el;
}
