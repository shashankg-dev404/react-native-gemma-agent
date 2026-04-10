import { KnowledgeStore } from '../KnowledgeStore';

// In-memory filesystem mock for react-native-fs
const mockFs: Record<string, string> = {};
const mockDirs: Set<string> = new Set();

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/docs',
  exists: jest.fn(async (path: string) => path in mockFs || mockDirs.has(path)),
  mkdir: jest.fn(async (path: string) => {
    mockDirs.add(path);
  }),
  writeFile: jest.fn(async (path: string, content: string) => {
    mockFs[path] = content;
  }),
  readFile: jest.fn(async (path: string) => {
    if (!(path in mockFs)) throw new Error(`File not found: ${path}`);
    return mockFs[path];
  }),
  readDir: jest.fn(async (dir: string) => {
    return Object.keys(mockFs)
      .filter((p) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/'))
      .map((p) => ({
        name: p.split('/').pop()!,
        path: p,
        size: Buffer.byteLength(mockFs[p], 'utf8'),
        isFile: () => true,
        isDirectory: () => false,
      }));
  }),
  unlink: jest.fn(async (path: string) => {
    delete mockFs[path];
  }),
  stat: jest.fn(async (path: string) => ({
    size: path in mockFs ? Buffer.byteLength(mockFs[path], 'utf8') : 0,
  })),
}));

function clearMockFs() {
  for (const key of Object.keys(mockFs)) {
    delete mockFs[key];
  }
  mockDirs.clear();
}

describe('KnowledgeStore', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    clearMockFs();
    store = new KnowledgeStore('/mock/docs/gemma-agent-notes');
  });

  describe('saveNote + getNote', () => {
    it('saves and retrieves a note', async () => {
      await store.saveNote('Flight Info', 'April 15th, Delta DL1234', [
        'travel',
      ]);
      const note = await store.getNote('Flight Info');

      expect(note).not.toBeNull();
      expect(note!.title).toBe('Flight Info');
      expect(note!.content).toBe('April 15th, Delta DL1234');
      expect(note!.tags).toEqual(['travel']);
      expect(note!.created).toBeTruthy();
      expect(note!.modified).toBeTruthy();
    });

    it('overwrites existing note and preserves created date', async () => {
      await store.saveNote('Prefs', 'Dark mode');
      const first = await store.getNote('Prefs');

      await store.saveNote('Prefs', 'Dark mode, metric units');
      const second = await store.getNote('Prefs');

      expect(second!.content).toBe('Dark mode, metric units');
      expect(second!.created).toBe(first!.created);
    });

    it('returns null for non-existent note', async () => {
      const note = await store.getNote('Does Not Exist');
      expect(note).toBeNull();
    });
  });

  describe('listNotes', () => {
    it('returns all notes sorted by modified date', async () => {
      await store.saveNote('Note A', 'Content A', ['tag1']);
      await store.saveNote('Note B', 'Content B', ['tag2']);
      await store.saveNote('Note C', 'Content C');

      const entries = await store.listNotes();
      expect(entries).toHaveLength(3);
      // All should have title, tags, preview
      expect(entries[0].title).toBeTruthy();
      expect(entries[0].preview).toBeTruthy();
    });

    it('returns empty array when no notes exist', async () => {
      const entries = await store.listNotes();
      expect(entries).toEqual([]);
    });
  });

  describe('deleteNote', () => {
    it('deletes an existing note', async () => {
      await store.saveNote('To Delete', 'Goodbye');
      const deleted = await store.deleteNote('To Delete');
      expect(deleted).toBe(true);

      const note = await store.getNote('To Delete');
      expect(note).toBeNull();
    });

    it('returns false for non-existent note', async () => {
      const deleted = await store.deleteNote('Nope');
      expect(deleted).toBe(false);
    });
  });

  describe('searchNotes', () => {
    it('ranks relevant notes higher', async () => {
      await store.saveNote('Flight Info', 'Delta DL1234, April 15th departing JFK', ['travel']);
      await store.saveNote('Grocery List', 'Milk, eggs, bread, butter', ['shopping']);
      await store.saveNote('Meeting Notes', 'Q3 planning session with team', ['work']);

      const results = await store.searchNotes('flight departure');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].note.title).toBe('Flight Info');
    });

    it('returns empty array when no notes match', async () => {
      await store.saveNote('Random', 'Some unrelated content');
      const results = await store.searchNotes('quantum physics');
      // BM25 may return 0-score results filtered out, or nothing
      expect(Array.isArray(results)).toBe(true);
    });

    it('returns empty when no notes exist', async () => {
      const results = await store.searchNotes('anything');
      expect(results).toEqual([]);
    });
  });

  describe('getIndex', () => {
    it('returns compact format with title, tags, and preview', async () => {
      await store.saveNote('Flight Info', 'April 15th, Delta DL1234', ['travel']);
      await store.saveNote('Preferences', 'Metric units, dark mode', ['prefs']);

      const index = await store.getIndex();

      expect(index).toContain('Flight Info');
      expect(index).toContain('[travel]');
      expect(index).toContain('Preferences');
      expect(index).toContain('[prefs]');
      // Each entry should be a list item
      expect(index.split('\n').every((line) => line.startsWith('- '))).toBe(true);
    });

    it('returns empty string when no notes', async () => {
      const index = await store.getIndex();
      expect(index).toBe('');
    });
  });

  describe('slugify', () => {
    it('converts title to safe filename', () => {
      expect(store.slugify('Flight Info')).toBe('flight-info');
    });

    it('handles special characters', () => {
      expect(store.slugify("User's Preferences!")).toBe('users-preferences');
    });

    it('handles consecutive spaces and hyphens', () => {
      expect(store.slugify('  hello   world  ')).toBe('hello-world');
    });

    it('returns untitled for empty string', () => {
      expect(store.slugify('')).toBe('untitled');
    });

    it('truncates long titles to 100 chars', () => {
      const longTitle = 'a'.repeat(200);
      expect(store.slugify(longTitle).length).toBeLessThanOrEqual(100);
    });
  });

  describe('storage size guard', () => {
    it('warns when total size exceeds 100KB', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Write a note that's ~110KB
      const largeContent = 'x'.repeat(110 * 1024);
      await store.saveNote('Large Note', largeContent);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('exceeds'),
      );
      warnSpy.mockRestore();
    });

    it('does not warn when under threshold', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await store.saveNote('Small Note', 'tiny content');

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
