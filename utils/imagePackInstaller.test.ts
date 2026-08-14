import * as FileSystem from 'expo-file-system/legacy';
import { strToU8, zipSync } from 'fflate';
import {
  ImagePackValidationError,
  IMAGE_PACK_INSTALL_DIR,
  MAX_IMAGE_PACK_BYTES,
  installImagePackFromUri,
  validateImagePackArchive,
} from './imagePackInstaller';

const KNOWN_KEYS = new Set([
  'Barbell_Full_Squat',
  'Barbell_Bench_Press_-_Medium_Grip',
]);

const jpeg = (marker: number): Uint8Array =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, marker]);

const zipPack = (images: Record<string, Uint8Array>, version = 1): Uint8Array =>
  zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        version,
        images: Object.fromEntries(
          Object.keys(images).map((key) => [key, `images/${key}.jpg`]),
        ),
      }),
    ),
    ...Object.fromEntries(
      Object.entries(images).map(([key, content]) => [`images/${key}.jpg`, content]),
    ),
  });

describe('validateImagePackArchive', () => {
  it('accepts a pack whose manifest matches the catalog', () => {
    const pack = validateImagePackArchive(
      zipPack({
        'Barbell_Full_Squat': jpeg(1),
        'Barbell_Bench_Press_-_Medium_Grip': jpeg(2),
      }),
      KNOWN_KEYS,
    );

    expect(pack.images.size).toBe(2);
    expect(pack.images.get('Barbell_Full_Squat')).toEqual(jpeg(1));
    expect(pack.images.get('Barbell_Bench_Press_-_Medium_Grip')).toEqual(jpeg(2));
  });

  it('tolerates directory entries from folder-zipped archives', () => {
    const zip = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          version: 1,
          images: { Barbell_Full_Squat: 'images/Barbell_Full_Squat.jpg' },
        }),
      ),
      'images/': new Uint8Array(0),
      'images/Barbell_Full_Squat.jpg': jpeg(1),
    });

    expect(validateImagePackArchive(zip, KNOWN_KEYS).images.size).toBe(1);
  });

  it('rejects bytes that are not a zip archive', () => {
    expect(() =>
      validateImagePackArchive(strToU8('this is not a zip file at all'), KNOWN_KEYS),
    ).toThrow(ImagePackValidationError);
    expect(() =>
      validateImagePackArchive(strToU8('this is not a zip file at all'), KNOWN_KEYS),
    ).toThrow('not a readable zip');
  });

  it('rejects a truncated zip archive', () => {
    const full = zipPack({ 'Barbell_Full_Squat': jpeg(1) });
    expect(() => validateImagePackArchive(full.slice(0, 24), KNOWN_KEYS)).toThrow(
      'not a readable zip',
    );
  });

  it('rejects an archive without a manifest', () => {
    const zip = zipSync({ 'images/Barbell_Full_Squat.jpg': jpeg(1) });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow(
      /manifest/,
    );
  });

  it('rejects a malformed manifest', () => {
    const zip = zipSync({ 'manifest.json': strToU8('{not json') });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow('valid JSON');
  });

  it('rejects an unsupported manifest version', () => {
    expect(() =>
      validateImagePackArchive(zipPack({ 'Barbell_Full_Squat': jpeg(1) }, 2), KNOWN_KEYS),
    ).toThrow('manifest must be');
  });

  it('rejects a manifest that lists no images', () => {
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ version: 1, images: {} })),
    });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow(
      'lists no images',
    );
  });

  it('rejects a key that is not in the catalog', () => {
    const zip = zipPack({ 'Not_A_Catalog_Exercise': jpeg(1) });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow(
      'not an exercise in the catalog',
    );
  });

  it('rejects a manifest path outside the images directory', () => {
    const zip = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          version: 1,
          images: { Barbell_Full_Squat: '../evil.jpg' },
        }),
      ),
      'images/Barbell_Full_Squat.jpg': jpeg(1),
    });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow(
      'must be "images/<key>.jpg"',
    );
  });

  it('rejects an archive entry the manifest does not declare', () => {
    const zip = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          version: 1,
          images: { Barbell_Full_Squat: 'images/Barbell_Full_Squat.jpg' },
        }),
      ),
      'images/Barbell_Full_Squat.jpg': jpeg(1),
      'images/Smuggled.jpg': jpeg(2),
    });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow(
      'not declared by the manifest',
    );
  });

  it('rejects an archive missing a declared image', () => {
    const zip = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          version: 1,
          images: {
            'Barbell_Full_Squat': 'images/Barbell_Full_Squat.jpg',
            'Barbell_Bench_Press_-_Medium_Grip': 'images/Barbell_Bench_Press_-_Medium_Grip.jpg',
          },
        }),
      ),
      'images/Barbell_Full_Squat.jpg': jpeg(1),
    });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow(
      'missing one or more images',
    );
  });

  it('rejects a declared file that is not a JPEG', () => {
    const zip = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          version: 1,
          images: { Barbell_Full_Squat: 'images/Barbell_Full_Squat.jpg' },
        }),
      ),
      'images/Barbell_Full_Squat.jpg': strToU8('definitely not a jpeg'),
    });
    expect(() => validateImagePackArchive(zip, KNOWN_KEYS)).toThrow(
      'not a JPEG',
    );
  });

  it('rejects an archive over the size limit', () => {
    expect(() =>
      validateImagePackArchive(new Uint8Array(MAX_IMAGE_PACK_BYTES + 1), KNOWN_KEYS),
    ).toThrow('exceeds the size limit');
  });

  it('never writes when validation fails', async () => {
    const writes: string[] = [];
    mockedFileSystem.readAsStringAsync.mockResolvedValue(
      toBase64(zipPack({ 'Not_A_Catalog_Exercise': jpeg(1) })),
    );
    mockedFileSystem.makeDirectoryAsync.mockImplementation(
      (path: string) => {
        writes.push(path);
        return Promise.resolve();
      },
    );
    mockedFileSystem.writeAsStringAsync.mockImplementation((path: string) => {
      writes.push(path);
      return Promise.resolve();
    });

    await expect(
      installImagePackFromUri('file:///picked/pack.zip', KNOWN_KEYS),
    ).rejects.toThrow(ImagePackValidationError);
    expect(writes).toEqual([]);
  });
});

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  readAsStringAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  moveAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

const mockedFileSystem = jest.mocked(FileSystem);

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
};

const installDirectory = `file:///documents/${IMAGE_PACK_INSTALL_DIR}`;

const filesystemMock = {
  paths: new Map<string, 'file' | 'directory'>(),
  write: (path: string, kind: 'file' | 'directory') => {
    filesystemMock.paths.set(path, kind);
  },
  reset: () => {
    filesystemMock.paths.clear();
  },
};

describe('installImagePackFromUri', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    filesystemMock.reset();

    mockedFileSystem.readAsStringAsync.mockResolvedValue(
      toBase64(
        zipPack({
          'Barbell_Full_Squat': jpeg(1),
          'Barbell_Bench_Press_-_Medium_Grip': jpeg(2),
        }),
      ),
    );
    mockedFileSystem.makeDirectoryAsync.mockImplementation(
      (path: string) => Promise.resolve(filesystemMock.write(path, 'directory')),
    );
    mockedFileSystem.writeAsStringAsync.mockImplementation((path: string) =>
      Promise.resolve(filesystemMock.write(path, 'file')),
    );
    mockedFileSystem.getInfoAsync.mockImplementation((path: string) => {
      const exists = filesystemMock.paths.has(path);
      if (!exists) {
        return Promise.resolve({ exists: false, uri: path, isDirectory: false });
      }
      return Promise.resolve({
        exists: true as const,
        uri: path,
        size: 0,
        isDirectory: true,
        modificationTime: 0,
      });
    });
    mockedFileSystem.moveAsync.mockImplementation(
      ({ from, to }: { from: string; to: string }) => {
        const moved = [...filesystemMock.paths.keys()].filter(
          (path) => path === from || path.startsWith(`${from}/`),
        );
        if (moved.length === 0) {
          return Promise.reject(new Error(`no such path: ${from}`));
        }
        for (const path of moved) {
          filesystemMock.paths.delete(path);
          filesystemMock.write(path.replace(from, to), 'directory');
        }
        return Promise.resolve();
      },
    );
    mockedFileSystem.deleteAsync.mockImplementation((path: string) => {
      filesystemMock.paths.delete(path);
      return Promise.resolve();
    });
  });

  it('stages, swaps, and cleans up on success', async () => {
    const count = await installImagePackFromUri('file:///picked/pack.zip', KNOWN_KEYS);

    expect(count).toBe(2);
    expect(filesystemMock.paths.has(installDirectory)).toBe(true);
    const leftoverStaging = [...filesystemMock.paths.keys()].filter((path) =>
      path.includes('image-pack-installing-'),
    );
    expect(leftoverStaging).toEqual([]);
  });

  it('re-installing over an existing pack replaces it cleanly', async () => {
    filesystemMock.write(installDirectory, 'directory');

    await installImagePackFromUri('file:///picked/pack.zip', KNOWN_KEYS);

    expect(filesystemMock.paths.has(installDirectory)).toBe(true);
    const leftoverBackups = [...filesystemMock.paths.keys()].filter((path) =>
      path.includes('image-pack.backup-'),
    );
    expect(leftoverBackups).toEqual([]);
  });

  it('restores the previous pack when the swap fails', async () => {
    filesystemMock.write(installDirectory, 'directory');
    mockedFileSystem.moveAsync.mockImplementation(
      ({ from, to }: { from: string; to: string }) => {
        if (from === installDirectory || from.includes('image-pack.backup-')) {
          const moved = [...filesystemMock.paths.keys()].filter(
            (path) => path === from || path.startsWith(`${from}/`),
          );
          for (const path of moved) {
            filesystemMock.paths.delete(path);
            filesystemMock.write(path.replace(from, to), 'directory');
          }
          return Promise.resolve();
        }
        return Promise.reject(new Error('install move failed'));
      },
    );

    await expect(
      installImagePackFromUri('file:///picked/pack.zip', KNOWN_KEYS),
    ).rejects.toThrow('install move failed');
    expect(filesystemMock.paths.has(installDirectory)).toBe(true);
    const leftoverBackups = [...filesystemMock.paths.keys()].filter((path) =>
      path.includes('image-pack.backup-'),
    );
    expect(leftoverBackups).toEqual([]);
  });

  it('leaves no partial install when writing a file fails', async () => {
    mockedFileSystem.writeAsStringAsync.mockImplementation((path: string) =>
      Promise.reject(new Error('disk full')),
    );

    await expect(
      installImagePackFromUri('file:///picked/pack.zip', KNOWN_KEYS),
    ).rejects.toThrow('disk full');
    expect(filesystemMock.paths.has(installDirectory)).toBe(false);
    const leftovers = [...filesystemMock.paths.keys()].filter(
      (path) => path.includes('image-pack-installing-') || path.includes('image-pack.backup-'),
    );
    expect(leftovers).toEqual([]);
  });
});
