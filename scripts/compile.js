#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const appDir = path.join(rootDir, 'app');
const shouldEmitApp = process.argv.includes('--emit-app');

function assertPathExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function removeDir(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyDir(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(fromDir, entry.name);
    const targetPath = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

try {
  assertPathExists(srcDir, 'Source directory');
  if (shouldEmitApp) {
    removeDir(appDir);
    copyDir(srcDir, appDir);
    process.stdout.write('[compile] emitted app directory from src for fallback runtime\n');
  } else {
    process.stdout.write('[compile] no transpilation required under Node 20 + ThinkJS 4 alpha\n');
    process.stdout.write('[compile] run with --emit-app to generate app fallback artifact\n');
  }
} catch (error) {
  process.stderr.write(`[compile] failed: ${error.message}\n`);
  process.exit(1);
}
