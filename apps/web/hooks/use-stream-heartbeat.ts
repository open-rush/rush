/**
 * Stream Heartbeat Hook
 *
 * When useChat status transitions to "ready" after being active,
 * polls to check if there's an active stream that needs resuming.
 *
 * Simplified version of rush-app's useStreamHeartbeat.
 * Full resume requires a GET endpoint on /api/chat — for now this
 * just detects disconnections and calls resumeStream if available.
 */

import { useCallback, useEffect, useRef } from 'react';

export interface UseStreamHeartbeatOptions {
  enabled?: boolean;
  interval?: number;
  maxRetries?: number;
  onMaxRetriesReached?: () => void;
}

export function useStreamHeartbeat(
  projectId: string | undefined,
  status: string,
  isDisconnect: boolean,
  resumeStream: (() => void) | undefined,
  options?: UseStreamHeartbeatOptions
): void {
  const { enabled = true, interval = 1500, maxRetries = 5, onMaxRetriesReached } = options ?? {};

  const retryCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStatusRef = useRef(status);
  const isRunningRef = useRef(false);

  const stopHeartbeat = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    isRunningRef.current = false;
    retryCountRef.current = 0;
  }, []);

  const startHeartbeat = useCallback(() => {
    if (isRunningRef.current || !enabled || !projectId) return;
    isRunningRef.current = true;

    const loop = () => {
      if (!isRunningRef.current) return;
      if (retryCountRef.current >= maxRetries) {
        isRunningRef.current = false;
        onMaxRetriesReached?.();
        return;
      }

      retryCountRef.current++;

      // Try to resume the stream
      if (resumeStream) {
        try {
          resumeStream();
        } catch {
          // resume failed, schedule next try
          timerRef.current = setTimeout(loop, interval);
          return;
        }
      }

      // After calling resume, stop heartbeat — if it fails again,
      // the status transition will re-trigger heartbeat
      isRunningRef.current = false;
    };

    loop();
  }, [enabled, projectId, maxRetries, interval, resumeStream, onMaxRetriesReached]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (!enabled || !projectId) {
      stopHeartbeat();
      return;
    }

    // Only attempt resume after an explicit disconnect signal.
    const wasActive = prev === 'streaming' || prev === 'submitted' || prev === 'error';
    if (status === 'ready' && wasActive && isDisconnect) {
      startHeartbeat();
    } else if (status === 'streaming' || status === 'submitted') {
      // Connection re-established, stop heartbeat
      stopHeartbeat();
    }
  }, [status, enabled, projectId, isDisconnect, startHeartbeat, stopHeartbeat]);

  // Cleanup
  useEffect(() => {
    return () => stopHeartbeat();
  }, [stopHeartbeat]);
}
