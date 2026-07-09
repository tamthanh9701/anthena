var esbuild = require('esbuild');
var fs = require('fs');
var path = require('path');

var src = path.resolve(__dirname, 'anthena-sync');
var dist = path.resolve(__dirname, 'anthena-sync', 'dist');
var isPackage = process.argv[2] === '--package';

if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });

// Step 1: Bundle code.js
esbuild.buildSync({
  entryPoints: [path.resolve(src, 'code.js')],
  outfile: path.resolve(dist, 'code.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2018',
  minify: true,
  external: ['__html__']
});
console.log('  Bundle: code.js');

// Step 2: Generate dist/manifest.json (not copied from source — source points to dist/)
var distManifest = {
  name: 'Anthena Sync',
  id: 'anthena-sync',
  api: '1.0.0',
  main: 'code.js',
  ui: 'ui.html',
  editorType: ['figma'],
  documentAccess: 'dynamic-page',
  capabilities: [],
  networkAccess: { allowedDomains: ['none'] }
};
fs.writeFileSync(path.resolve(dist, 'manifest.json'), JSON.stringify(distManifest, null, 2));
console.log('  Generate: dist/manifest.json');

// Step 3: Copy ui.html
if (fs.existsSync(path.resolve(src, 'ui.html'))) {
  fs.copyFileSync(path.resolve(src, 'ui.html'), path.resolve(dist, 'ui.html'));
  console.log('  Copy: ui.html');
}

console.log('Figma plugin build complete.');

// Step 4: Package zip (only with --package flag)
if (isPackage) {
  var AdmZip = require('adm-zip');
  var zip = new AdmZip();
  zip.addLocalFile(path.resolve(dist, 'code.js'));
  zip.addLocalFile(path.resolve(dist, 'manifest.json'));
  zip.addLocalFile(path.resolve(dist, 'ui.html'));
  var outPath = path.resolve(dist, 'figma-plugin.zip');
  zip.writeZip(outPath);
  console.log('  Package: figma-plugin.zip');
  console.log('Package complete.');
}