const copyButton = document.querySelector('.copy-btn');

if (copyButton) {
  copyButton.addEventListener('click', async () => {
    const text = copyButton.getAttribute('data-copy') || '';

    try {
      await navigator.clipboard.writeText(text);
      const original = copyButton.textContent;
      copyButton.textContent = 'Copied';
      window.setTimeout(() => {
        copyButton.textContent = original;
      }, 1200);
    } catch {
      copyButton.textContent = 'Copy failed';
      window.setTimeout(() => {
        copyButton.textContent = 'Copy';
      }, 1200);
    }
  });
}
