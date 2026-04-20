#!/usr/bin/env node
/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { URL } from 'node:url';
import type { IncomingMessage } from 'node:http';
import { BUILT_IN_MODELS, listModels, type ModelRegistryEntry } from '../ModelRegistry';

const HF_BASE = 'https://huggingface.co';
const MAX_REDIRECTS = 5;

function printUsage(): void {
  console.log('Usage: npx react-native-gemma-agent pull <model-id>');
  console.log('');
  console.log('Available model IDs:');
  for (const id of listModels()) {
    const entry = BUILT_IN_MODELS[id];
    const gb = (entry.expectedSize / 1_000_000_000).toFixed(1);
    console.log(`  ${id.padEnd(20)} ${entry.name.padEnd(28)} ${gb} GB`);
  }
}

function cacheDir(modelId: string): string {
  return join(homedir(), '.cache', 'react-native-gemma-agent', 'models', modelId);
}

function buildUrl(entry: ModelRegistryEntry): string {
  return `${HF_BASE}/${entry.repoId}/resolve/${entry.commitSha}/${entry.filename}`;
}

type DownloadResult = { sha256: string; bytes: number };

function httpDownload(
  url: string,
  destPath: string,
  totalBytes: number,
  redirectsLeft: number,
  token: string | undefined,
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'react-native-gemma-agent/cli',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const parsed = new URL(url);
    const req = httpsGet(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          httpDownload(next, destPath, totalBytes, redirectsLeft - 1, token).then(resolve, reject);
          return;
        }

        if (status === 401 || status === 403) {
          reject(
            new Error(
              `HTTP ${status}. This repo may require authentication. Set HF_TOKEN in your environment (https://huggingface.co/settings/tokens).`,
            ),
          );
          return;
        }

        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} fetching ${url}`));
          return;
        }

        const expected =
          Number(res.headers['content-length']) > 0
            ? Number(res.headers['content-length'])
            : totalBytes;
        const hasher = createHash('sha256');
        const out = createWriteStream(destPath);
        let received = 0;
        let lastPrint = 0;

        res.on('data', (chunk: Buffer) => {
          hasher.update(chunk);
          received += chunk.length;
          const now = Date.now();
          if (now - lastPrint > 500 && expected > 0) {
            const pct = Math.floor((received / expected) * 100);
            process.stdout.write(
              `\r  ${pct.toString().padStart(3)}%  ${(received / 1_000_000).toFixed(1)} / ${(expected / 1_000_000).toFixed(1)} MB`,
            );
            lastPrint = now;
          }
        });

        res.on('error', reject);
        out.on('error', reject);
        res.pipe(out);
        out.on('finish', () => {
          process.stdout.write('\n');
          resolve({ sha256: hasher.digest('hex'), bytes: received });
        });
      },
    );
    req.on('error', reject);
  });
}

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

async function fileMatchesChecksum(path: string, sha256: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }
  const hasher = createHash('sha256');
  const handle = await fs.open(path, 'r');
  try {
    const stream = handle.createReadStream();
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) =>
        hasher.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
      );
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
  } finally {
    await handle.close();
  }
  return hasher.digest('hex').toLowerCase() === sha256.toLowerCase();
}

async function pull(modelId: string): Promise<void> {
  const entry = BUILT_IN_MODELS[modelId];
  if (!entry) {
    console.error(`Unknown model "${modelId}".`);
    printUsage();
    process.exit(1);
  }

  const dir = cacheDir(modelId);
  const finalPath = join(dir, entry.filename);
  const partialPath = `${finalPath}.partial`;
  await ensureDir(dirname(finalPath));

  if (await fileMatchesChecksum(finalPath, entry.sha256)) {
    console.log(`Already cached and verified: ${finalPath}`);
    printAdbHint(entry.filename, finalPath);
    return;
  }

  const url = buildUrl(entry);
  console.log(`Downloading ${entry.name}`);
  console.log(`  from: ${url}`);
  console.log(`  to:   ${finalPath}`);

  const { sha256, bytes } = await httpDownload(
    url,
    partialPath,
    entry.expectedSize,
    MAX_REDIRECTS,
    process.env.HF_TOKEN,
  );

  if (sha256.toLowerCase() !== entry.sha256.toLowerCase()) {
    await fs.unlink(partialPath).catch(() => undefined);
    throw new Error(
      `SHA-256 mismatch: expected ${entry.sha256}, got ${sha256}. File deleted.`,
    );
  }

  await fs.rename(partialPath, finalPath);
  console.log(`Verified SHA-256. Wrote ${bytes} bytes.`);
  printAdbHint(entry.filename, finalPath);
}

function printAdbHint(filename: string, path: string): void {
  console.log('');
  console.log('To push this model to a connected Android device:');
  console.log(`  adb push ${path} /data/local/tmp/${filename}`);
}

async function main(): Promise<void> {
  const [, , subcommand, arg] = process.argv;

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printUsage();
    return;
  }

  if (subcommand !== 'pull') {
    if (BUILT_IN_MODELS[subcommand]) {
      console.error(`"${subcommand}" is a model id, not a subcommand. Did you mean: pull ${subcommand}`);
    } else {
      console.error(`Unknown subcommand "${subcommand}".`);
    }
    printUsage();
    process.exit(1);
  }

  if (!arg) {
    console.error('pull requires a model id.');
    printUsage();
    process.exit(1);
  }

  await pull(arg);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
