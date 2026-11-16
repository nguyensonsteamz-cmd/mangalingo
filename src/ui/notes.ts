/**
 * The reader's own notes (phrase ↔ meaning), kept in chrome.storage.local (the app's local storage)
 * under "notes:v1". Separate from the vocabulary notebook; each note can be copied there.
 */
import { useEffect, useState } from 'react';

export interface Note {
  id: string;
  phrase: string;
  meaning: string;
  /** Sentence / bubble the note was written for. */
  context?: string;
  createdAt: number;
}

const KEY = 'notes:v1';
const MAX = 2000;

async function read(): Promise<Note[]> {
  const r = await chrome.storage.local.get(KEY);
  const list = r[KEY];
  return Array.isArray(list) ? (list as Note[]) : [];
}
const write = (list: Note[]) => chrome.storage.local.set({ [KEY]: list.slice(0, MAX) });

export const notesStore = {
  list: read,
  async add(n: Omit<Note, 'id' | 'createdAt'>): Promise<Note> {
    const note: Note = { ...n, phrase: n.phrase.trim().slice(0, 500), meaning: n.meaning.trim().slice(0, 2000), id: Math.random().toString(36).slice(2, 10), createdAt: Date.now() };
    await write([note, ...(await read())]);
    return note;
  },
  async update(id: string, patch: Partial<Pick<Note, 'phrase' | 'meaning'>>) {
    await write((await read()).map((n) => (n.id === id ? { ...n, ...patch } : n)));
  },
  async remove(id: string) {
    await write((await read()).filter((n) => n.id !== id));
  },
};

/** Live list of notes (newest first). */
export function useNotes(): Note[] {
  const [list, setList] = useState<Note[]>([]);
  useEffect(() => {
    let alive = true;
    void read().then((l) => alive && setList(l));
    const on = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && KEY in changes) setList((changes[KEY].newValue as Note[]) ?? []);
    };
    chrome.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(on);
    };
  }, []);
  return list;
}
