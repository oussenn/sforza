// Applies the saved appearance before the first paint (see src/lib/theme.ts): the contrast (dark class), the theme
// (data-look) with its favicon and, for the custom theme, its stored colour tokens. The PDF page stays standard and light.
// A file, not an inline script, so the Content-Security-Policy in _headers can forbid inline scripts.
try {
  var root = document.documentElement
  if (location.pathname !== '/print') {
    var t = localStorage.getItem('theme')
    var dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) {
      root.classList.add('dark')
      root.style.colorScheme = 'dark'
    }
    var look = localStorage.getItem('look')
    if (look === 'sakura' || look === 'terminal' || look === 'space' || look === 'custom') {
      root.setAttribute('data-look', look)
      var icon = document.querySelector('link[rel="icon"]')
      if (icon && look !== 'custom') icon.href = '/themes/' + look + '/favicon.png'
      if (look === 'custom') {
        var vars = JSON.parse(localStorage.getItem('palette-vars') || 'null')
        var set = vars && vars[dark ? 'dark' : 'light']
        for (var k in set) if (/^--[a-z0-9-]+$/.test(k) && typeof set[k] === 'string') root.style.setProperty(k, set[k])
      }
    }
  }
} catch (e) {}
