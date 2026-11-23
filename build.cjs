// Bundle local sources into the same portable HTML used by the current app.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const source = path.join(root, 'src');
let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, file) =>
  '<style>\n' + fs.readFileSync(path.join(source, file), 'utf8') + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, file) =>
  '<script>\n' + fs.readFileSync(path.join(source, file), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
for (const file of ['index.html', 'MFC2000-HMI-Graphs-Viewer.html']) {
  fs.writeFileSync(path.join(root, file), html);
}
console.log('Built MFC2000 HMI Graphs Viewer: ' + Buffer.byteLength(html) + ' bytes');
