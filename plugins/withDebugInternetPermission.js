const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

const INTERNET_PERMISSION = 'android.permission.INTERNET';
const INTERNET_PERMISSION_PATTERN = new RegExp(
  `<uses-permission\\b[^>]*\\bandroid:name\\s*=\\s*["']${INTERNET_PERMISSION}["'][^>]*\\/?\\s*>`,
);

function addInternetPermissionToManifest(manifest) {
  if (INTERNET_PERMISSION_PATTERN.test(manifest)) {
    return manifest;
  }

  const applicationTagIndex = manifest.search(/<application(?:\s|>)/);
  if (applicationTagIndex === -1) {
    throw new Error('Generated debug AndroidManifest.xml is missing its application element');
  }

  const lineStart = manifest.lastIndexOf('\n', applicationTagIndex) + 1;
  const indentation = manifest.slice(lineStart, applicationTagIndex);
  const lineEnding = manifest.includes('\r\n') ? '\r\n' : '\n';
  const permission = `${indentation}<uses-permission android:name="${INTERNET_PERMISSION}" />${lineEnding}`;

  return `${manifest.slice(0, lineStart)}${permission}${manifest.slice(lineStart)}`;
}

module.exports = function withDebugInternetPermission(config) {
  // The debug source set is outside the main manifest mod, so CNG needs a file-level mod here.
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const manifestPath = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/debug/AndroidManifest.xml',
      );
      const manifest = await fs.readFile(manifestPath, 'utf8');
      const updatedManifest = addInternetPermissionToManifest(manifest);

      if (updatedManifest !== manifest) {
        await fs.writeFile(manifestPath, updatedManifest);
      }

      return config;
    },
  ]);
};
