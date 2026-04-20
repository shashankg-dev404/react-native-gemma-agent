import React, {
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { SkillResult } from './types';

export type SkillSandboxHandle = {
  execute: (
    html: string,
    params: Record<string, unknown>,
    timeout?: number,
  ) => Promise<SkillResult>;
};

type PendingExecution = {
  resolve: (result: SkillResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const SkillSandbox = forwardRef<SkillSandboxHandle>(
  function SkillSandbox(_props, ref) {
    const pendingRef = useRef<PendingExecution | null>(null);
    const [source, setSource] = useState<{ html: string } | undefined>(
      undefined,
    );

    const handleMessage = useCallback((event: WebViewMessageEvent) => {
      const pending = pendingRef.current;
      if (!pending) return;

      pendingRef.current = null;
      clearTimeout(pending.timer);

      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'skill_error') {
          pending.resolve({ error: data.error });
        } else if (data.type === 'skill_result') {
          pending.resolve(data.data);
        } else {
          pending.resolve({ error: 'Unknown response type from skill' });
        }
      } catch {
        pending.resolve({ error: 'Failed to parse skill response' });
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        execute: (
          html: string,
          params: Record<string, unknown>,
          timeout = 30_000,
        ): Promise<SkillResult> => {
          // Cancel any pending execution
          if (pendingRef.current) {
            clearTimeout(pendingRef.current.timer);
            pendingRef.current.reject(
              new Error('Execution cancelled: new skill started'),
            );
            pendingRef.current = null;
          }

          return new Promise<SkillResult>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingRef.current = null;
              resolve({ error: `Skill timed out after ${timeout}ms` });
            }, timeout);

            pendingRef.current = { resolve, reject, timer };

            const injectedHtml = injectExecutionScript(html, params);
            setSource({ html: injectedHtml });
          });
        },
      }),
      [],
    );

    return (
      <View style={styles.container} pointerEvents="none">
        {source && (
          <WebView
            source={source}
            onMessage={handleMessage}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled={false}
            incognito
            style={styles.webview}
          />
        )}
      </View>
    );
  },
);

/**
 * Inject the execution bridge script into skill HTML.
 * Calls window['ai_edge_gallery_get_result'] with the params
 * and posts the result back via ReactNativeWebView.postMessage.
 */
function injectExecutionScript(
  html: string,
  params: Record<string, unknown>,
): string {
  const escapedParams = JSON.stringify(JSON.stringify(params));

  const executionScript = `
<script>
(async () => {
  await new Promise(r => setTimeout(r, 100));
  try {
    const fn = window['ai_edge_gallery_get_result'];
    if (!fn) throw new Error('Skill function ai_edge_gallery_get_result not found');
    const result = await fn(${escapedParams});
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'skill_result',
      data: JSON.parse(result)
    }));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'skill_error',
      error: e.message || 'Unknown skill error'
    }));
  }
})();
</script>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${executionScript}\n</body>`);
  }
  return html + executionScript;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  webview: {
    width: 1,
    height: 1,
    opacity: 0,
  },
});
