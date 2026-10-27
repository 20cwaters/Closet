import { useSyncExternalStore } from 'react';
import type { Item, PersonId } from '../api';
import { putItem } from './items';
import { ITEM_PHOTO_MAX, resizeImage, upload } from './resize';

/**
 * Photos being added, kept outside React so uploads carry on if you leave the Add screen.
 * Each photo is resized in the browser, then uploaded; two run at once.
 */
export interface Upload {
  key: string;
  person: PersonId;
  file: File;
  stage: 'waiting' | 'resizing' | 'uploading' | 'done' | 'error';
  progress: number;
  itemId?: number;
  error?: string;
}

let uploads: Upload[] = [];
const listeners = new Set<() => void>();
let seq = 0;
let active = 0;
const PARALLEL = 2;

function set(key: string, patch: Partial<Upload>) {
  uploads = uploads.map((u) => (u.key === key ? { ...u, ...patch } : u));
  listeners.forEach((l) => l());
}

export function addPhotos(person: PersonId, files: FileList | File[]) {
  const fresh = Array.from(files).map<Upload>((file) => ({
    key: `u${++seq}`,
    person,
    file,
    stage: 'waiting',
    progress: 0,
  }));
  uploads = [...uploads, ...fresh];
  listeners.forEach((l) => l());
  pump();
}

export function retryUpload(key: string) {
  set(key, { stage: 'waiting', progress: 0, error: undefined });
  pump();
}

export function dismissUpload(key: string) {
  uploads = uploads.filter((u) => u.key !== key);
  listeners.forEach((l) => l());
}

/** Forget finished uploads for a person (their items now live on the server). */
export function clearFinished(person: PersonId) {
  uploads = uploads.filter((u) => u.person !== person || u.stage !== 'done');
  listeners.forEach((l) => l());
}

function pump() {
  while (active < PARALLEL) {
    const next = uploads.find((u) => u.stage === 'waiting');
    if (!next) return;
    active++;
    set(next.key, { stage: 'resizing' });
    run(next).finally(() => {
      active--;
      pump();
    });
  }
}

async function run(u: Upload) {
  try {
    const blob = await resizeImage(u.file, ITEM_PHOTO_MAX);
    set(u.key, { stage: 'uploading' });
    const item = await upload<Item>('/api/items', blob, (p) => set(u.key, { progress: p }), {
      owner: u.person,
    });
    putItem(item);
    set(u.key, { stage: 'done', progress: 1, itemId: item.id });
  } catch (e) {
    set(u.key, { stage: 'error', error: (e as Error).message });
  }
}

export function useUploads(person: PersonId) {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => uploads,
  );
  return all.filter((u) => u.person === person);
}
