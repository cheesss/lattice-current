import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const distDir = resolve(process.cwd(), 'dist');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
  console.log('[ensure:dist] created dist/');
} else {
  console.log('[ensure:dist] dist/ already exists');
}
