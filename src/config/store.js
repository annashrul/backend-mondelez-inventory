import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedData } from '../data/seed.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configuredPath = process.env.DATA_FILE || './data/inventory.json';
const dataFile = path.resolve(backendRoot, configuredPath);
let writeQueue = Promise.resolve();

async function ensureStore() {
  await mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await readFile(dataFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(dataFile, `${JSON.stringify(seedData, null, 2)}\n`, 'utf8');
  }
}

export async function readStore() {
  await ensureStore();
  return JSON.parse(await readFile(dataFile, 'utf8'));
}

export function updateStore(updater) {
  const operation = writeQueue.then(async () => {
    const data = await readStore();
    const result = await updater(data);
    const temporaryFile = `${dataFile}.tmp`;
    await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, dataFile);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}