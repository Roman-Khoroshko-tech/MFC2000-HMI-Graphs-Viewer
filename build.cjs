// Bundle local sources into the same portable HTML used by the current app.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const source = path.join(root, 'src');
let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, file) =>
  '<style>\n' + fs.readFileSync(path.join(source, file), 'utf8') + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, file) => {
  const script = fs.readFileSync(path.join(source, file), 'utf8');
  new vm.Script(script, { filename: file });
  return '<script>\n' + script.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
// Keep generated files identical on Windows and on GitHub's Linux environment.
html = html.replace(/\r\n/g, '\n');
const check = process.argv.includes('--check');
for (const file of ['index.html', 'MFC2000-HMI-Graphs-Viewer.html']) {
  const output = path.join(root, file);
  if (check) {
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== html) {
      throw new Error(file + ' is missing or outdated. Run node build.cjs.');
    }
  } else {
    fs.writeFileSync(output, html);
  }
}
console.log((check ? 'Verified' : 'Built') + ' MFC2000 HMI Graphs Viewer: ' + Buffer.byteLength(html) + ' bytes');
