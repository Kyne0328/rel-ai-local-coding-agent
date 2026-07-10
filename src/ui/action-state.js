function messageFor(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The action failed.';
}

export function setButtonState(button, state, text) {
  if (!button) return;
  if (state === 'idle') delete button.dataset.state;
  else button.dataset.state = state;
  button.disabled = state === 'loading';
  if (text) button.textContent = text;
}

export async function runButtonAction(button, options, action) {
  const idleText = options?.idleText || button?.textContent || '';
  const loadingText = options?.loadingText || 'Working…';
  const successText = options?.successText || idleText;
  const errorText = options?.errorText || idleText;
  const successDuration = Number(options?.successDuration || 900);

  setButtonState(button, 'loading', loadingText);
  try {
    const result = await action();
    if (result?.ok === false) {
      setButtonState(button, 'error', errorText);
      window.setTimeout(() => setButtonState(button, 'idle', idleText), 1200);
      return result;
    }
    setButtonState(button, 'success', successText);
    window.setTimeout(() => setButtonState(button, 'idle', idleText), successDuration);
    return result;
  } catch (error) {
    setButtonState(button, 'error', errorText);
    window.setTimeout(() => setButtonState(button, 'idle', idleText), 1200);
    return { ok: false, error: messageFor(error) };
  }
}
