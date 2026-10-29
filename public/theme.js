// Applies the saved theme before the first paint (see src/lib/theme.ts). The PDF page stays light.
// A file, not an inline script, so the Content-Security-Policy in _headers can forbid inline scripts.
try {
  var t = localStorage.getItem('theme')
  if (location.pathname !== '/print' && (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches))) {
    document.documentElement.classList.add('dark')
    document.documentElement.style.colorScheme = 'dark'
  }
} catch (e) {}
