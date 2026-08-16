import * as FileSystem from 'expo-file-system/legacy';
import { strFromU8, unzipSync } from 'fflate';

/**
 * The image pack (§3.3 in ENGINEERING.md, G4 in SPECS.md): a zip of JPEGs for
 * catalog exercises, released through the project's GitHub releases. The app
 * never downloads it — "Download" hands the release URL to the system browser
 * (an intent handoff, no permission required) and "Install" takes the file
 * back through the document picker.
 *
 * Archive format (version 1):
 *
 *   manifest.json   { "version": 1, "images": { "<catalogKey>": "images/<catalogKey>.jpg", ... } }
 *   images/<catalogKey>.jpg   a JPEG file per entry
 *
 * The install follows the hardened database-import bar (Appendix B): the whole
 * archive is validated in memory before anything is written — manifest, catalog
 * keys, entry set, JPEG magic bytes — then files are staged in a temp
 * directory, the live install is moved to a backup, and only then is the staged
 * copy moved into place. Any failure restores the backup. Archive entry names
 * never become filesystem paths: files are written as "<catalogKey>.jpg" under
 * the install directory, so a path-traversal entry cannot escape it.
 */

export const IMAGE_PACK_RELEASE_URL =
  'https://github.com/Lutmak/simple-gym-tracker/releases';

/**
 * **No image pack has been published yet** (SPECS.md S4). The mechanism is
 * finished and the release page is real, but it is empty, so "Download" opens a
 * page with nothing on it. The screen says exactly that rather than implying an
 * install that cannot succeed — an honest dead end is a smaller defect than a
 * silent one. Flip this to `true` in the same commit that publishes a release.
 */
export const IMAGE_PACK_RELEASE_PUBLISHED = false;

export interface ImagePackFlowCopy {
  /** Line one: what the download row promises today. */
  downloadHintKey: string;
  /** Line two: what picking a file does. */
  installHintKey: string;
}

/**
 * The two lines that state the flow. Kept out of the screen because *which*
 * sentence is honest depends on whether a release exists, and that is a fact
 * about the project rather than a rendering decision.
 */
export function imagePackFlowCopy(releasePublished: boolean): ImagePackFlowCopy {
  return {
    downloadHintKey: releasePublished
      ? 'imagePackDownloadHint'
      : 'imagePackNoReleaseYet',
    installHintKey: 'imagePackInstallHint',
  };
}

export const IMAGE_PACK_INSTALL_DIR = 'image-pack';

export const IMAGE_PACK_MANIFEST_NAME = 'manifest.json';

/** Upper bound on the picked archive; bounds memory since it is inflated whole. */
export const MAX_IMAGE_PACK_BYTES = 64 * 1024 * 1024;

export type ImagePackRejectReason =
  | 'too-large'
  | 'not-a-zip'
  | 'missing-manifest'
  | 'invalid-manifest'
  | 'unsupported-version'
  | 'no-images'
  | 'unknown-exercise'
  | 'invalid-path'
  | 'missing-file'
  | 'not-a-jpeg'
  | 'foreign-file';

export class ImagePackValidationError extends Error {
  constructor(
    readonly reason: ImagePackRejectReason,
    message: string,
  ) {
    super(`Image pack rejected: ${message}`);
    this.name = 'ImagePackValidationError';
  }
}

export interface ImagePack {
  /** exerciseKey -> jpeg bytes */
  images: Map<string, Uint8Array>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJpeg = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[2] === 0xff;

const isDirectoryEntry = (name: string, content: Uint8Array): boolean =>
  name.endsWith('/') && content.length === 0;

const imagePathOf = (key: string): string => `images/${key}.jpg`;

export function validateImagePackArchive(
  bytes: Uint8Array,
  knownKeys: ReadonlySet<string>,
): ImagePack {
  if (bytes.length > MAX_IMAGE_PACK_BYTES) {
    throw new ImagePackValidationError(
      'too-large',
      'the archive exceeds the size limit.',
    );
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ImagePackValidationError(
      'not-a-zip',
      'the selected file is not a readable zip archive.',
    );
  }

  const manifestEntry = entries[IMAGE_PACK_MANIFEST_NAME];
  if (!manifestEntry) {
    throw new ImagePackValidationError(
      'missing-manifest',
      `no ${IMAGE_PACK_MANIFEST_NAME} at the archive root.`,
    );
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(manifestEntry));
  } catch {
    throw new ImagePackValidationError(
      'invalid-manifest',
      'the manifest is not valid JSON.',
    );
  }

  if (
    !isRecord(manifest) ||
    manifest.version !== 1 ||
    !isRecord(manifest.images)
  ) {
    throw new ImagePackValidationError(
      'invalid-manifest',
      'the manifest must be {"version": 1, "images": {key: path}}.',
    );
  }

  const manifestImages = manifest.images;
  const declaredPaths = new Set<string>();
  for (const [key, path] of Object.entries(manifestImages)) {
    if (typeof path !== 'string' || path !== imagePathOf(key)) {
      throw new ImagePackValidationError(
        'invalid-path',
        `image path for "${key}" must be "images/<key>.jpg".`,
      );
    }
    if (!knownKeys.has(key)) {
      throw new ImagePackValidationError(
        'unknown-exercise',
        `"${key}" is not an exercise in the catalog.`,
      );
    }
    declaredPaths.add(path);
  }

  if (declaredPaths.size === 0) {
    throw new ImagePackValidationError(
      'no-images',
      'the manifest lists no images.',
    );
  }

  const images = new Map<string, Uint8Array>();
  for (const [entryName, content] of Object.entries(entries)) {
    if (entryName === IMAGE_PACK_MANIFEST_NAME || isDirectoryEntry(entryName, content)) {
      continue;
    }
    if (!declaredPaths.has(entryName)) {
      throw new ImagePackValidationError(
        'foreign-file',
        `"${entryName}" is not declared by the manifest.`,
      );
    }
    if (content.length === 0 || !isJpeg(content)) {
      throw new ImagePackValidationError(
        'not-a-jpeg',
        `"${entryName}" is not a JPEG image.`,
      );
    }
    images.set(entryName.slice('images/'.length, -'.jpg'.length), content);
  }

  if (images.size !== declaredPaths.size) {
    throw new ImagePackValidationError(
      'missing-file',
      'the archive is missing one or more images declared by the manifest.',
    );
  }

  return { images };
}

const decodeBase64 = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return globalThis.btoa(binary);
};

/**
 * Validates the picked archive and installs it under
 * `documentDirectory/image-pack/`. Returns the number of images installed.
 * Nothing is written until validation passes, and a failed install restores
 * the previous pack.
 */
export async function installImagePackFromUri(
  sourceUri: string,
  knownKeys: ReadonlySet<string>,
): Promise<number> {
  const encoded = await FileSystem.readAsStringAsync(sourceUri, {
    encoding: 'base64',
  });
  const pack = validateImagePackArchive(decodeBase64(encoded), knownKeys);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stagedDirectory = `${FileSystem.cacheDirectory}image-pack-installing-${suffix}`;
  const installDirectory = `${FileSystem.documentDirectory}${IMAGE_PACK_INSTALL_DIR}`;
  const backupDirectory = `${FileSystem.documentDirectory}${IMAGE_PACK_INSTALL_DIR}.backup-${suffix}`;
  let originalMoved = false;
  let replacementInstalled = false;

  try {
    await FileSystem.makeDirectoryAsync(stagedDirectory, {
      intermediates: true,
    });
    for (const [key, jpeg] of pack.images) {
      await FileSystem.writeAsStringAsync(
        `${stagedDirectory}/${key}.jpg`,
        encodeBase64(jpeg),
        { encoding: 'base64' },
      );
    }

    const liveDirectory = await FileSystem.getInfoAsync(installDirectory);
    if (liveDirectory.exists) {
      await FileSystem.moveAsync({
        from: installDirectory,
        to: backupDirectory,
      });
      originalMoved = true;
    }

    await FileSystem.moveAsync({
      from: stagedDirectory,
      to: installDirectory,
    });
    replacementInstalled = true;

    if (originalMoved) {
      // A leftover backup is safer than failing after the new pack is installed.
      try {
        await FileSystem.deleteAsync(backupDirectory, { idempotent: true });
      } catch {
        // Keep the backup available for manual recovery.
      }
    }
  } catch (error) {
    if (originalMoved && !replacementInstalled) {
      try {
        const currentDirectory = await FileSystem.getInfoAsync(installDirectory);
        if (currentDirectory.exists) {
          await FileSystem.deleteAsync(installDirectory, { idempotent: true });
        }
        await FileSystem.moveAsync({
          from: backupDirectory,
          to: installDirectory,
        });
      } catch {
        throw new Error(
          'Image pack install failed and the previous pack could not be restored.',
        );
      }
    }

    throw error;
  } finally {
    try {
      await FileSystem.deleteAsync(stagedDirectory, { idempotent: true });
    } catch {
      // The staged directory is never the live install and can be cleaned up later.
    }
  }

  return pack.images.size;
}
