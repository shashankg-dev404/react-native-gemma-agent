import { useState, useCallback } from 'react';
import { useGemmaAgentContext } from './GemmaAgentProvider';
import type { NoteIndexEntry, Note } from './KnowledgeStore';

export type UseKnowledgeStoreReturn = {
  /** List of all notes (metadata + preview, no full content) */
  notes: NoteIndexEntry[];
  /** Save or update a note */
  saveNote: (title: string, content: string, tags?: string[]) => Promise<void>;
  /** Read a note by title */
  getNote: (title: string) => Promise<Note | null>;
  /** Search notes by query (BM25 ranked) */
  searchNotes: (
    query: string,
  ) => Promise<Array<{ note: Note; score: number }>>;
  /** Delete a note by title */
  deleteNote: (title: string) => Promise<boolean>;
  /** Refresh the notes list */
  refresh: () => Promise<void>;
};

export function useKnowledgeStore(): UseKnowledgeStoreReturn {
  const { knowledgeStore } = useGemmaAgentContext();

  if (!knowledgeStore) {
    throw new Error(
      'KnowledgeStore not available. Register the local_notes skill to enable it.',
    );
  }

  const [notes, setNotes] = useState<NoteIndexEntry[]>([]);

  const refresh = useCallback(async () => {
    const entries = await knowledgeStore.listNotes();
    setNotes(entries);
  }, [knowledgeStore]);

  const saveNote = useCallback(
    async (title: string, content: string, tags?: string[]) => {
      await knowledgeStore.saveNote(title, content, tags);
      await refresh();
    },
    [knowledgeStore, refresh],
  );

  const getNote = useCallback(
    (title: string) => knowledgeStore.getNote(title),
    [knowledgeStore],
  );

  const searchNotes = useCallback(
    (query: string) => knowledgeStore.searchNotes(query),
    [knowledgeStore],
  );

  const deleteNote = useCallback(
    async (title: string) => {
      const result = await knowledgeStore.deleteNote(title);
      await refresh();
      return result;
    },
    [knowledgeStore, refresh],
  );

  return { notes, saveNote, getNote, searchNotes, deleteNote, refresh };
}
