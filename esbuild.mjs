import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
mkdirSync(join(__dirname, 'dist'), { recursive: true });

// WASM 2개를 dist로 복사 (런타임 + php 문법)
copyFileSync(
  join(__dirname, 'node_modules/web-tree-sitter/web-tree-sitter.wasm'),
  join(__dirname, 'dist/web-tree-sitter.wasm'));
copyFileSync(
  join(__dirname, 'node_modules/tree-sitter-php/tree-sitter-php.wasm'),
  join(__dirname, 'dist/tree-sitter-php.wasm'));

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true, outfile: 'dist/extension.js',
  external: ['vscode'], format: 'cjs', platform: 'node',
  minify: production, sourcemap: !production,
  // web-tree-sitter는 런타임에 fs로 wasm을 읽으므로 번들에 포함하되 wasm은 파일로 복사됨.
  // web-tree-sitter는 ESM 기본이라 import.meta.url을 쓰는데, CJS 번들에서는 undefined가 되어
  // emscripten의 wasm 탐색이 new URL(undefined)로 깨진다 — 파일 URL로 치환해 넣어준다.
  banner: { js: 'const __ts_import_meta_url = require("url").pathToFileURL(__filename).href;' },
  define: { 'import.meta.url': '__ts_import_meta_url' },
});
console.log('build done');
