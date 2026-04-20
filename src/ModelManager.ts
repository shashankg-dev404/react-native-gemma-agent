import RNFS from 'react-native-fs';
import type { ModelStatus, ModelConfig, DownloadProgress, ModelInfo } from './types';

const DEFAULT_HF_BASE = 'https://huggingface.co';
const DOWNLOAD_CHUNK_TIMEOUT = 60_000;

type StatusListener = (status: ModelStatus) => void;
type ProgressListener = (progress: DownloadProgress) => void;

export function buildHuggingFaceUrl(
  repoId: string,
  filename: string,
  commitSha?: string,
): string {
  const ref = commitSha ?? 'main';
  return `${DEFAULT_HF_BASE}/${repoId}/resolve/${ref}/${filename}`;
}

export function assertChecksumMatches(
  actual: string,
  expected: string,
  filename: string,
): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `SHA-256 mismatch for ${filename}: expected ${expected}, got ${actual}.`,
    );
  }
}

export class ModelManager {
  private _status: ModelStatus = 'not_downloaded';
  private _modelPath: string | null = null;
  private _config: ModelConfig;
  private _downloadJobId: number | null = null;
  private _statusListeners: Set<StatusListener> = new Set();
  private _sizeBytes: number | null = null;

  constructor(config: ModelConfig) {
    this._config = config;
  }

  get status(): ModelStatus {
    return this._status;
  }

  get modelPath(): string | null {
    return this._modelPath;
  }

  onStatusChange(listener: StatusListener): () => void {
    this._statusListeners.add(listener);
    return () => this._statusListeners.delete(listener);
  }

  private setStatus(status: ModelStatus): void {
    this._status = status;
    for (const listener of this._statusListeners) {
      listener(status);
    }
  }

  /**
   * Check if the model file exists at common locations.
   * Returns the path if found, null otherwise.
   */
  async findModel(): Promise<string | null> {
    const candidates = [
      `${RNFS.DocumentDirectoryPath}/${this._config.filename}`,
      `/data/local/tmp/${this._config.filename}`,
      `${RNFS.CachesDirectoryPath}/${this._config.filename}`,
    ];

    for (const path of candidates) {
      if (await RNFS.exists(path)) {
        const stat = await RNFS.stat(path);
        this._sizeBytes = Number(stat.size);
        this._modelPath = path;
        this.setStatus('ready');
        return path;
      }
    }

    return null;
  }

  /**
   * Check if model exists and update status accordingly.
   */
  async checkModel(): Promise<boolean> {
    const path = await this.findModel();
    if (path) {
      return true;
    }
    this.setStatus('not_downloaded');
    return false;
  }

  /**
   * Download model from HuggingFace with progress.
   * Supports resume via HTTP Range headers.
   */
  async download(onProgress?: ProgressListener): Promise<string> {
    if (this._status === 'downloading') {
      throw new Error('Download already in progress');
    }

    // Check if already downloaded
    const existing = await this.findModel();
    if (existing) {
      onProgress?.({ bytesDownloaded: this._sizeBytes!, totalBytes: this._sizeBytes!, percent: 100 });
      return existing;
    }

    this.setStatus('downloading');

    const destPath = `${RNFS.DocumentDirectoryPath}/${this._config.filename}`;
    const url = this.buildDownloadUrl();

    // Check for partial download (resume support)
    let existingBytes = 0;
    const partialPath = `${destPath}.partial`;
    if (await RNFS.exists(partialPath)) {
      const stat = await RNFS.stat(partialPath);
      existingBytes = Number(stat.size);
    }

    try {
      const headers: Record<string, string> = {};
      if (existingBytes > 0) {
        headers['Range'] = `bytes=${existingBytes}-`;
      }

      const totalBytes = this._config.expectedSize ?? 0;

      const result = RNFS.downloadFile({
        fromUrl: url,
        toFile: partialPath,
        headers,
        begin: (res) => {
          const contentLength = res.contentLength;
          if (contentLength > 0 && totalBytes === 0) {
            // Update expected size from Content-Length
          }
        },
        progress: (res) => {
          const downloaded = existingBytes + res.bytesWritten;
          const total = totalBytes || (existingBytes + res.contentLength);
          const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          onProgress?.({ bytesDownloaded: downloaded, totalBytes: total, percent });
        },
        progressInterval: 500,
        progressDivider: 0,
        readTimeout: DOWNLOAD_CHUNK_TIMEOUT,
        connectionTimeout: 15_000,
      });

      this._downloadJobId = result.jobId;

      const response = await result.promise;

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (this._config.checksum) {
          const actual = await RNFS.hash(partialPath, 'sha256');
          try {
            assertChecksumMatches(actual, this._config.checksum, this._config.filename);
          } catch (err) {
            await RNFS.unlink(partialPath);
            throw err;
          }
        }

        if (await RNFS.exists(destPath)) {
          await RNFS.unlink(destPath);
        }
        await RNFS.moveFile(partialPath, destPath);

        this._modelPath = destPath;
        const stat = await RNFS.stat(destPath);
        this._sizeBytes = Number(stat.size);
        this._downloadJobId = null;
        this.setStatus('ready');

        onProgress?.({ bytesDownloaded: this._sizeBytes, totalBytes: this._sizeBytes, percent: 100 });
        return destPath;
      }

      throw new Error(`Download failed with status ${response.statusCode}`);
    } catch (err) {
      this._downloadJobId = null;

      // Don't delete partial file: allows resume on retry
      if (this._status !== 'ready') {
        this.setStatus('error');
      }
      throw err;
    }
  }

  /**
   * Cancel an in-progress download.
   */
  cancelDownload(): void {
    if (this._downloadJobId !== null) {
      RNFS.stopDownload(this._downloadJobId);
      this._downloadJobId = null;
      this.setStatus('not_downloaded');
    }
  }

  /**
   * Set a custom model path (for pre-downloaded models).
   */
  async setModelPath(path: string): Promise<void> {
    if (!(await RNFS.exists(path))) {
      throw new Error(`Model file not found at ${path}`);
    }
    const stat = await RNFS.stat(path);
    this._sizeBytes = Number(stat.size);
    this._modelPath = path;
    this.setStatus('ready');
  }

  /**
   * Delete the downloaded model file.
   */
  async deleteModel(): Promise<void> {
    if (this._modelPath && (await RNFS.exists(this._modelPath))) {
      await RNFS.unlink(this._modelPath);
    }

    // Also clean up partial downloads
    const partialPath = `${RNFS.DocumentDirectoryPath}/${this._config.filename}.partial`;
    if (await RNFS.exists(partialPath)) {
      await RNFS.unlink(partialPath);
    }

    this._modelPath = null;
    this._sizeBytes = null;
    this.setStatus('not_downloaded');
  }

  /**
   * Get model info.
   */
  getInfo(): ModelInfo {
    return {
      status: this._status,
      path: this._modelPath,
      sizeBytes: this._sizeBytes,
      description: null,
      nParams: null,
      nEmbd: null,
    };
  }

  /**
   * Check available storage space.
   */
  async checkStorage(): Promise<{ available: number; required: number; sufficient: boolean }> {
    const fsInfo = await RNFS.getFSInfo();
    const required = this._config.expectedSize ?? 0;
    return {
      available: fsInfo.freeSpace,
      required,
      sufficient: required === 0 || fsInfo.freeSpace > required * 1.1, // 10% buffer
    };
  }

  private buildDownloadUrl(): string {
    return buildHuggingFaceUrl(this._config.repoId, this._config.filename, this._config.commitSha);
  }
}
