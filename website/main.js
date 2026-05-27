const copyButtons = document.querySelectorAll('.copy-btn');

copyButtons.forEach((button) => {
  const originalText = button.textContent || 'Copy';
  let timeoutId = null;

  button.addEventListener('click', async () => {
    const text = (button.getAttribute('data-copy') || '').replace(/\\n/g, '\n');

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }

    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }

    timeoutId = window.setTimeout(() => {
      button.textContent = originalText;
      timeoutId = null;
    }, 1200);
  });
});
