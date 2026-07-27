import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
mkdirSync(join(__dirname, 'dist'), { recursive: true });

// WASM 2개를 dist로 복사 (런타임 + php 문법)
copyFileSync(
  join(__dirname, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
  join(__dirname, 'dist/tree-sitter.wasm'));
copyFileSync(
  join(__dirname, 'node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm'),
  join(__dirname, 'dist/tree-sitter-php.wasm'));

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true, outfile: 'dist/extension.js',
  external: ['vscode'], format: 'cjs', platform: 'node',
  minify: production, sourcemap: !production,
  // web-tree-sitter는 런타임에 fs로 wasm을 읽으므로 번들에 포함하되 wasm은 파일로 복사됨
});
console.log('build done');
