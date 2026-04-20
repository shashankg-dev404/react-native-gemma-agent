import RNFS from 'react-native-fs';
import { BM25Scorer } from './BM25Scorer';
import type { SkillManifest } from './types';

const NOTES_DIR = 'gemma-agent-notes';
const SIZE_WARN_BYTES = 100 * 1024; // 100KB soft warning
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB hard cap

export type NoteMetadata = {
  title: string;
  tags: string[];
  created: string;
  modified: string;
};

export type Note = NoteMetadata & {
  content: string;
};

export type NoteIndexEntry = {
  title: string;
  tags: string[];
  preview: string;
  modified: string;
};

/**
 * On-device knowledge base stored as markdown files with YAML frontmatter.
 * Notes persist across app restarts. BM25 search for retrieval.
 *
 * **Privacy note**: Notes are stored as plaintext `.md` files in the app's
 * DocumentDirectory. On Android this is app-private. On iOS this directory
 * is included in iCloud/iTunes backups by default. Do not store secrets,
 * passwords, or highly sensitive data in notes.
 */
export class KnowledgeStore {
  private basePath: string;
  private sizeWarned = false;

  constructor(basePath?: string) {
    this.basePath =
      basePath ?? `${RNFS.DocumentDirectoryPath}/${NOTES_DIR}`;
  }

  private async ensureDir(): Promise<void> {
    if (!(await RNFS.exists(this.basePath))) {
      await RNFS.mkdir(this.basePath);
    }
  }

  /**
   * Resolve a filename to a safe path within basePath.
   * Rejects any path that escapes the notes directory.
   */
  private resolveSafePath(filename: string): string {
    const resolved = `${this.basePath}/${filename}`;
    if (!resolved.startsWith(this.basePath + '/')) {
      throw new Error(`[KnowledgeStore] Invalid filename: ${filename}`);
    }
    return resolved;
  }

  /**
   * Strip control characters (newlines, tabs, etc.) from a string
   * to prevent YAML frontmatter injection.
   */
  private sanitize(value: string): string {
    return value.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
  }

  /**
   * Save or update a note. If a note with the same title exists, it's overwritten.
   */
  async saveNote(
    title: string,
    content: string,
    tags: string[] = [],
  ): Promise<void> {
    await this.ensureDir();

    const safeTitle = this.sanitize(title);
    const safeTags = tags.map((t) => this.sanitize(t));

    const filename = this.slugify(safeTitle) + '.md';
    const filepath = this.resolveSafePath(filename);
    const now = new Date().toISOString();

    let created = now;
    // Preserve original creation date if updating
    if (await RNFS.exists(filepath)) {
      const existing = await this.readFile(filepath);
      const meta = this.parseFrontmatter(existing);
      // Slug collision guard: reject if file belongs to a different title
      if (meta && meta.title !== safeTitle) {
        throw new Error(
          `[KnowledgeStore] Title "${safeTitle}" conflicts with existing note "${meta.title}" (same filename). Use a different title.`,
        );
      }
      if (meta?.created) {
        created = meta.created;
      }
    }

    const frontmatter = [
      '---',
      `title: "${safeTitle.replace(/"/g, '\\"')}"`,
      `tags: [${safeTags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`,
      `created: "${created}"`,
      `modified: "${now}"`,
      '---',
    ].join('\n');

    const fileContent = `${frontmatter}\n\n${content}`;

    // Pre-check: enforce size cap before writing.
    // Use string length as byte estimate (close enough for UTF-8 ASCII-heavy notes).
    // This is a guard rail, not an exact meter. getTotalSize() uses actual file sizes.
    const newSize = fileContent.length;
    const currentTotal = await this.getTotalSize();
    // If updating an existing file, subtract its old size
    let existingSize = 0;
    if (await RNFS.exists(filepath)) {
      const stat = await RNFS.stat(filepath);
      existingSize = Number(stat.size);
    }
    const projectedTotal = currentTotal - existingSize + newSize;
    if (projectedTotal > MAX_TOTAL_BYTES) {
      throw new Error(
        `[KnowledgeStore] Storage limit would be exceeded (${Math.round(projectedTotal / 1024)}KB). ` +
          'Delete old notes before saving new ones.',
      );
    }

    await RNFS.writeFile(filepath, fileContent, 'utf8');

    // Soft warning (non-blocking)
    if (!this.sizeWarned && projectedTotal > SIZE_WARN_BYTES) {
      this.sizeWarned = true;
      console.warn(
        `[KnowledgeStore] Notes storage exceeds ${SIZE_WARN_BYTES / 1024}KB ` +
          `(${Math.round(projectedTotal / 1024)}KB). Consider pruning old notes.`,
      );
    }
  }

  /**
   * Read a note by title. Returns null if the file doesn't exist
   * or if the stored title doesn't match (slug collision).
   */
  async getNote(title: string): Promise<Note | null> {
    await this.ensureDir();

    const filename = this.slugify(title) + '.md';
    const filepath = this.resolveSafePath(filename);

    if (!(await RNFS.exists(filepath))) {
      return null;
    }

    const raw = await this.readFile(filepath);
    const note = this.parseNote(raw);

    // Guard against slug collisions: verify the stored title matches
    if (note && this.slugify(note.title) === this.slugify(title) && note.title !== this.sanitize(title)) {
      return null;
    }

    return note;
  }

  /**
   * Search notes using BM25 ranking. Returns notes sorted by relevance.
   */
  async searchNotes(
    query: string,
  ): Promise<Array<{ note: Note; score: number }>> {
    const notes = await this.listNotesWithContent();

    if (notes.length === 0) return [];

    // Build BM25 index from notes as pseudo-skills. Local scorer to avoid shared state.
    const scorer = new BM25Scorer();
    const pseudoSkills: SkillManifest[] = notes.map((n) => ({
      name: n.title,
      description: `${n.content} ${n.tags.join(' ')}`,
      version: '1.0.0',
      type: 'native' as const,
      parameters: {},
      execute: async () => ({ result: '' }),
    }));

    scorer.buildIndex(pseudoSkills);
    const ranked = scorer.score(query);

    return ranked
      .filter((r) => r.score > 0)
      .map((r) => {
        const note = notes.find((n) => n.title === r.skill.name)!;
        return { note, score: r.score };
      });
  }

  /**
   * List all notes (metadata only, no full content).
   */
  async listNotes(): Promise<NoteIndexEntry[]> {
    await this.ensureDir();

    const files = await RNFS.readDir(this.basePath);
    const mdFiles = files.filter((f) => f.name.endsWith('.md') && f.isFile());

    const entries: NoteIndexEntry[] = [];
    for (const file of mdFiles) {
      const raw = await this.readFile(file.path);
      const meta = this.parseFrontmatter(raw);
      if (meta) {
        const body = this.extractBody(raw);
        entries.push({
          title: meta.title,
          tags: meta.tags,
          preview: body.slice(0, 80).trim(),
          modified: meta.modified,
        });
      }
    }

    return entries.sort(
      (a, b) =>
        new Date(b.modified).getTime() - new Date(a.modified).getTime(),
    );
  }

  /**
   * Delete a note by title. Verifies the stored title matches
   * before deleting to prevent slug collision accidents.
   */
  async deleteNote(title: string): Promise<boolean> {
    await this.ensureDir();

    const filename = this.slugify(title) + '.md';
    const filepath = this.resolveSafePath(filename);

    if (!(await RNFS.exists(filepath))) {
      return false;
    }

    // Verify stored title matches before deleting (slug collision guard)
    const raw = await this.readFile(filepath);
    const meta = this.parseFrontmatter(raw);
    if (meta && meta.title !== this.sanitize(title)) {
      return false;
    }

    await RNFS.unlink(filepath);
    return true;
  }

  /**
   * Get a compact index string suitable for system prompt injection.
   * Format: one line per note with title, tags, and first line of content.
   * Previews are stripped of structural markers to prevent prompt injection.
   */
  async getIndex(): Promise<string> {
    const entries = await this.listNotes();

    if (entries.length === 0) return '';

    return entries
      .map((e) => {
        const tagsStr = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : '';
        // Strip structural markers from preview to reduce prompt injection surface
        const safePreview = e.preview
          .replace(/^#+\s/g, '')
          .replace(/^---/g, '')
          .replace(/^>/g, '');
        return `- ${e.title}${tagsStr}: ${safePreview}`;
      })
      .join('\n');
  }

  /**
   * Get total storage used by all notes in bytes.
   */
  async getTotalSize(): Promise<number> {
    await this.ensureDir();

    const files = await RNFS.readDir(this.basePath);
    let total = 0;
    for (const file of files) {
      if (file.isFile() && file.name.endsWith('.md')) {
        total += Number(file.size);
      }
    }
    return total;
  }

  /**
   * Convert title to a safe filename slug.
   */
  slugify(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'untitled';
  }

  private async listNotesWithContent(): Promise<Note[]> {
    await this.ensureDir();

    const files = await RNFS.readDir(this.basePath);
    const mdFiles = files.filter((f) => f.name.endsWith('.md') && f.isFile());

    const notes: Note[] = [];
    for (const file of mdFiles) {
      const raw = await this.readFile(file.path);
      const note = this.parseNote(raw);
      if (note) notes.push(note);
    }
    return notes;
  }

  private async readFile(path: string): Promise<string> {
    return RNFS.readFile(path, 'utf8');
  }

  private parseFrontmatter(raw: string): NoteMetadata | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const fm = match[1];

    const title = this.extractYamlValue(fm, 'title');
    const created = this.extractYamlValue(fm, 'created') ?? '';
    const modified = this.extractYamlValue(fm, 'modified') ?? '';
    const tagsMatch = fm.match(/tags:\s*\[(.*?)\]/);
    const tags = tagsMatch
      ? tagsMatch[1]
          .split(',')
          .map((t) => t.trim().replace(/^"|"$/g, ''))
          .filter(Boolean)
      : [];

    if (!title) return null;

    return { title, tags, created, modified };
  }

  /**
   * Extract a quoted YAML value. Handles escaped quotes within the value.
   */
  private extractYamlValue(yaml: string, key: string): string | null {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = yaml.match(new RegExp(`${escaped}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (!match) return null;
    // Unescape \" back to "
    return match[1].replace(/\\"/g, '"');
  }

  private extractBody(raw: string): string {
    const match = raw.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)/);
    return match ? match[1].trim() : raw.trim();
  }

  private parseNote(raw: string): Note | null {
    const meta = this.parseFrontmatter(raw);
    if (!meta) return null;
    const content = this.extractBody(raw);
    return { ...meta, content };
  }

}
