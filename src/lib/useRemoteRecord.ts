/**
 * Loads a saved analysis into the session when it is not already in this tab.
 * Local-only builds (no backend configured) report that unsaved work is lost on reload.
 */
export function useRemoteRecord(_id: string, enabled: boolean): { loading: boolean; error: string | null } {
  return {
    loading: false,
    error: enabled ? 'This analysis is not in this browser tab. Unsaved local work is lost on reload; export run.json to keep it.' : null,
  };
}
