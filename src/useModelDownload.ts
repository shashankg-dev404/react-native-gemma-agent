import { useState, useCallback, useRef } from 'react';
import { useGemmaAgentContext } from './GemmaAgentProvider';
import type { ModelStatus, DownloadProgress } from './types';

export type UseModelDownloadReturn = {
  /** Start downloading the model. Resolves with the local file path. */
  download: () => Promise<string>;
  /** Cancel an in-progress download */
  cancelDownload: () => void;
  /** Check if model already exists on device */
  checkModel: () => Promise<boolean>;
  /** Set a custom model path (for pre-downloaded models) */
  setModelPath: (path: string) => Promise<void>;
  /** Delete the downloaded model file */
  deleteModel: () => Promise<void>;
  /** Current download progress */
  progress: DownloadProgress | null;
  /** Current model status */
  status: ModelStatus;
  /** Check available storage */
  checkStorage: () => Promise<{ available: number; required: number; sufficient: boolean }>;
};

export function useModelDownload(): UseModelDownloadReturn {
  const { modelManager } = useGemmaAgentContext();

  const [status, setStatus] = useState<ModelStatus>(modelManager.status);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);
  if (!unsubRef.current) {
    unsubRef.current = modelManager.onStatusChange((s) => {
      setStatus(s);
    });
  }

  const download = useCallback(async (): Promise<string> => {
    setProgress(null);
    const path = await modelManager.download((p) => {
      setProgress(p);
    });
    return path;
  }, [modelManager]);

  const cancelDownload = useCallback(() => {
    modelManager.cancelDownload();
    setProgress(null);
  }, [modelManager]);

  const checkModel = useCallback(
    () => modelManager.checkModel(),
    [modelManager],
  );

  const setModelPath = useCallback(
    (path: string) => modelManager.setModelPath(path),
    [modelManager],
  );

  const deleteModel = useCallback(
    () => modelManager.deleteModel(),
    [modelManager],
  );

  const checkStorage = useCallback(
    () => modelManager.checkStorage(),
    [modelManager],
  );

  return {
    download,
    cancelDownload,
    checkModel,
    setModelPath,
    deleteModel,
    progress,
    status,
    checkStorage,
  };
}
