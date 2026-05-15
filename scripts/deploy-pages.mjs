// 极简部署辅助：把 dist/ 复制到独立输出目录，方便推到 gh-pages 或静态托管。
// 用法：npm run deploy:pages
import { execSync } from 'node:child_process';
import { existsSync, rmSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const dist = resolve(root, 'dist');
const out = resolve(root, '.gh-pages-out');

if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

if (existsSync(out)) {
  rmSync(out, { recursive: true, force: true });
}
mkdirSync(out, { recursive: true });
cpSync(dist, out, { recursive: true });

// .nojekyll 阻止 GitHub Pages 用 Jekyll 处理原始构建产物。
writeFileSync(resolve(out, '.nojekyll'), '');

console.log('\nReady. Now from `.gh-pages-out/`:');
console.log('  git init && git checkout -b gh-pages');
console.log('  git add -A && git commit -m "deploy"');
console.log('  git remote add origin <YOUR_REPO_URL>');
console.log('  git push -f origin gh-pages\n');
console.log('Or use any static host (Netlify / Vercel / Cloudflare Pages) by uploading this folder.');
