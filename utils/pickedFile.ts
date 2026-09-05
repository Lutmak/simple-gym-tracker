import * as FileSystem from 'expo-file-system/legacy';

/**
 * A document-picker result cannot be read where it is picked, on Expo Go or a standalone build
 * alike (U6, X2's original fix and its own regression on a Downloads-provider file):
 *
 * - `copyToCacheDirectory: true` copies the file to a path Expo Go's scoped-storage check
 *   rejects as unreadable — it lands outside this experience's own scoped cache.
 * - `copyToCacheDirectory: false` avoids that copy and hands back the picker's own
 *   `content://` URI, but the legacy `expo-file-system` module's `readAsStringAsync` only
 *   understands `file://` — it rejects a `content://` source outright (observed against
 *   Android's Downloads provider: `Unsupported scheme for location 'content://...'`).
 *
 * What does work in both places is `copyAsync`, whose legacy implementation resolves a
 * `content://` source through the content resolver. So the picker is always asked for the
 * untouched `content://` URI (`copyToCacheDirectory: false`), and this module copies it once
 * into a `file://` path this app already owns — after that, every other legacy file operation
 * (`readAsStringAsync`, a further `copyAsync`, `moveAsync`) works on it normally.
 */

/**
 * Copies a picked file into this app's own cache directory and returns the resulting `file://`
 * path. The caller owns that path: pass it wherever a URI was previously read directly (a
 * database restore, an image-pack install), and call `cleanupStagedFile` in a `finally` once
 * done with it — a stray copy in cache is otherwise never cleaned up.
 */
export async function stagePickedFile(sourceUri: string, fileName: string): Promise<string> {
  const stagedPath = `${FileSystem.cacheDirectory}picked-${Date.now()}-${fileName}`;
  await FileSystem.copyAsync({ from: sourceUri, to: stagedPath });
  return stagedPath;
}

/** Deletes a path `stagePickedFile` returned. Idempotent: safe to call even if already gone. */
export async function cleanupStagedFile(stagedPath: string): Promise<void> {
  await FileSystem.deleteAsync(stagedPath, { idempotent: true });
}

/**
 * The all-in-one form for a caller that only ever needs the picked file's text (a routine
 * document): stages it, reads it, cleans up the staged copy, and returns the content.
 */
export async function readPickedFileAsText(
  sourceUri: string,
  fileName: string,
  encoding: 'utf8' | 'base64' = 'utf8',
): Promise<string> {
  const stagedPath = await stagePickedFile(sourceUri, fileName);
  try {
    return await FileSystem.readAsStringAsync(stagedPath, { encoding });
  } finally {
    await cleanupStagedFile(stagedPath);
  }
}
