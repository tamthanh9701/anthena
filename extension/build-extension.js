const esbuild = require("esbuild");
const { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const dist = resolve(__dirname, "dist");

// Step 0: Ensure Vite output exists (popup)
if (!existsSync(resolve(dist, "popup", "popup.js"))) {
  console.error("Run 'npm run build' (Vite) first to build popup.");
  process.exit(1);
}

// Step 1: Bundle JS-only entries with esbuild
const entries = [
  { in: "src/background/service-worker.js", out: "background/service-worker" },
  { in: "src/content/content-script.js", out: "content/content-script" },
  { in: "src/injected/page-world-fiber-extractor.js", out: "injected/page-world-fiber-extractor" },
  { in: "src/injected/page-world-token-probe.js", out: "injected/page-world-token-probe" },
];

for (const entry of entries) {
  esbuild.buildSync({
    entryPoints: [resolve(__dirname, entry.in)],
    outfile: resolve(dist, entry.out + ".js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: false,
    sourcemap: false,
  });
  console.log("  JS:", entry.out + ".js");
}

// Step 2: Copy public files (manifest.json, icons)
const pub = resolve(__dirname, "public");
if (existsSync(pub)) {
  const walk = (dir, base) => {
    for (const e of readdirSync(dir)) {
      const f = resolve(dir, e), r = resolve(base, e), d = resolve(dist, r);
      if (statSync(f).isDirectory()) {
        if (!existsSync(d)) mkdirSync(d, { recursive: true });
        walk(f, r);
      } else {
        mkdirSync(resolve(d, ".."), { recursive: true });
        copyFileSync(f, d);
        console.log("  copy:", r);
      }
    }
  };
  walk(pub, ".");
}

// Step 3: Generate placeholder icons if missing
const iconsDir = resolve(dist, "icons");
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
const emptyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
for (const size of [16, 48, 128]) {
  const iconPath = resolve(iconsDir, "icon" + size + ".png");
  if (!existsSync(iconPath)) {
    writeFileSync(iconPath, emptyPng);
    console.log("  icon:", "icon" + size + ".png (placeholder)");
  }
}

// Step 4: Move popup HTML from Vite's src/popup/ to popup/
const srcHtml = resolve(dist, "src", "popup", "index.html");
const dstHtml = resolve(dist, "popup", "index.html");
if (existsSync(srcHtml)) {
  copyFileSync(srcHtml, dstHtml);
  rmSync(resolve(dist, "src"), { recursive: true, force: true });
  console.log("  popup HTML moved to popup/index.html");
}

console.log("Extension build complete.");
