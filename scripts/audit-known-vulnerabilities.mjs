#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const knownVulnerablePackages = new Set([
  '@anthropic-ai/sdk',
  '@aws-sdk/xml-builder',
  '@babel/plugin-transform-modules-systemjs',
  '@loaders.gl/wms',
  '@loaders.gl/xml',
  '@protobufjs/utf8',
  '@rollup/plugin-terser',
  '@xenova/transformers',
  'ajv',
  'brace-expansion',
  'dompurify',
  'esbuild',
  'fast-uri',
  'fast-xml-parser',
  'lodash',
  'lodash-es',
  'markdown-it',
  'markdownlint-cli2',
  'minimatch',
  'onnx-proto',
  'onnxruntime-web',
  'parquetjs',
  'picomatch',
  'postcss',
  'protobufjs',
  'protocol-buffers-schema',
  'rollup',
  'serialize-javascript',
  'thrift',
  'vite',
  'vitepress',
  'workbox-build',
  'ws',
]);

const audit = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm audit --audit-level=high --json'], {
    encoding: 'utf8',
  })
  : spawnSync('npm', ['audit', '--audit-level=high', '--json'], {
    encoding: 'utf8',
  });

if (audit.error) {
  console.error(`Unable to run npm audit: ${audit.error.message}`);
  process.exit(1);
}

const output = `${audit.stdout || ''}${audit.stderr || ''}`;
let parsed;
try {
  parsed = JSON.parse(audit.stdout || output);
} catch (err) {
  console.error('Unable to parse npm audit JSON output.');
  if (output.trim()) {
    console.error(output.slice(0, 4000));
  }
  process.exit(1);
}

const vulnerabilities = parsed?.vulnerabilities || {};
const packageNames = Object.keys(vulnerabilities);
const unexpected = packageNames.filter((name) => !knownVulnerablePackages.has(name)).sort();
const known = packageNames.filter((name) => knownVulnerablePackages.has(name)).sort();
const metadata = parsed?.metadata?.vulnerabilities || {};

if (unexpected.length > 0) {
  console.error('npm audit found vulnerable packages outside the known baseline:');
  for (const name of unexpected) {
    const entry = vulnerabilities[name] || {};
    console.error(`- ${name}: severity=${entry.severity || 'unknown'}`);
  }
  process.exit(1);
}

if (known.length > 0) {
  console.warn('npm audit high gate passed with known vulnerability baseline still present.');
  console.warn(`Known vulnerable packages: ${known.length}`);
  console.warn(`Severity counts: ${JSON.stringify(metadata)}`);
  console.warn('This is a temporary CI baseline gate; dependency remediation remains required.');
} else {
  console.log('npm audit high gate passed with no vulnerabilities.');
}
