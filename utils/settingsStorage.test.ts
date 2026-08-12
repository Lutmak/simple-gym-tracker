import * as FileSystem from 'expo-file-system/legacy';

import { loadSettings, saveSettings } from './settingsStorage';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

const mockedFileSystem = jest.mocked(FileSystem);

describe('settingsStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves settings as JSON in the document directory', async () => {
    const settings = { dateFormat: 'DD/MM/YYYY', units: 'kg' };

    await saveSettings(settings);

    expect(mockedFileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///documents/userSettings.json',
      JSON.stringify(settings)
    );
  });

  it('loads saved settings when the settings file exists', async () => {
    mockedFileSystem.getInfoAsync.mockResolvedValue({
      exists: true,
      uri: 'file:///documents/userSettings.json',
      size: 0,
      isDirectory: false,
      modificationTime: 0,
    });
    mockedFileSystem.readAsStringAsync.mockResolvedValue(
      '{"dateFormat":"MM/DD/YYYY","units":"lb"}'
    );

    await expect(loadSettings()).resolves.toEqual({
      dateFormat: 'MM/DD/YYYY',
      units: 'lb',
    });
  });

  it('returns null when no settings file exists', async () => {
    mockedFileSystem.getInfoAsync.mockResolvedValue({
      exists: false,
      uri: 'file:///documents/userSettings.json',
      isDirectory: false,
    });

    await expect(loadSettings()).resolves.toBeNull();
    expect(mockedFileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });
});
