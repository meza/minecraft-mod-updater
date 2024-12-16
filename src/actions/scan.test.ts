import path from 'path';
import { chance } from 'jest-chance';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanResultGeneratorOverrides, generateScanResult } from '../../test/generateScanResult.js';
import { generateModConfig } from '../../test/modConfigGenerator.js';
import { generateModInstall } from '../../test/modInstallGenerator.js';
import { generateModsJson } from '../../test/modlistGenerator.js';
import { expectCommandStartTelemetry } from '../../test/telemetryHelper.js';
import { shouldAddScanResults } from '../interactions/shouldAddScanResults.js';
import { Logger } from '../lib/Logger.js';
import { ensureConfiguration, getModsFolder, readLockFile, writeConfigFile, writeLockFile } from '../lib/config.js';
import { getModFiles } from '../lib/fileHelper.js';
import { ModInstall, ModsJson, Platform } from '../lib/modlist.types.js';
import { scan as scanLib } from '../lib/scan.js';
import { ScanOptions, scan } from './scan.js';

interface LocalTestContext {
  logger: Logger;
  options: ScanOptions;
  randomConfiguration: ModsJson;
  randomInstallations: ModInstall[];
}

vi.mock('../lib/Logger.js');
vi.mock('../lib/scan.js');
vi.mock('../lib/config');
vi.mock('../interactions/shouldAddScanResults.js');
vi.mock('../lib/fileHelper.js');
vi.mock('../mmm.js');

const randomModDetails = (): ScanResultGeneratorOverrides => {
  return {
    name: chance.word(),
    platform: chance.pickone(Object.values(Platform)),
    modId: chance.word()
  };
};

describe('The Scan action', () => {
  beforeEach<LocalTestContext>((context) => {
    vi.resetAllMocks();
    context.logger = new Logger({} as never);
    context.options = {
      config: 'config.js',
      quiet: false,
      debug: false,
      add: false,
      prefer: chance.pickone(Object.values(Platform))
    };

    context.randomConfiguration = generateModsJson().generated;
    context.randomInstallations = [];

    vi.mocked(ensureConfiguration).mockResolvedValue(context.randomConfiguration);
    vi.mocked(readLockFile).mockResolvedValueOnce(context.randomInstallations);
    vi.mocked(context.logger.error).mockImplementation(() => {
      throw new Error('process.exit');
    });
    vi.mocked(getModFiles).mockResolvedValueOnce([]);
    vi.mocked(getModsFolder).mockReturnValue(context.randomConfiguration.modsFolder);
  });
  describe('when there are unexpected errors', () => {
    it<LocalTestContext>('logs them correctly', async ({ options, logger }) => {
      const error = chance.word();
      vi.mocked(scanLib).mockRejectedValueOnce(new Error(error));
      await expect(scan(options, logger)).rejects.toThrow('process.exit');

      expect(logger.error).toHaveBeenCalledWith(error, 2);
    });
  });

  it<LocalTestContext>('correctly reports when there are no unmanaged mods', async ({ options, logger }) => {
    vi.mocked(scanLib).mockResolvedValueOnce([]);

    options.quiet = false;
    await scan(options, logger);

    expect(vi.mocked(logger.log).mock.calls[0][0]).toMatchInlineSnapshot('"✅ All of your mods are managed by mmm."');

    expect(vi.mocked(writeConfigFile)).not.toHaveBeenCalled();
    expect(vi.mocked(writeLockFile)).not.toHaveBeenCalled();
  });

  it<LocalTestContext>('properly logs found mods', async ({ options, logger }) => {
    const name = chance.word();
    const randomResult = generateScanResult({ name: name }).generated;

    vi.mocked(scanLib).mockResolvedValueOnce([randomResult]);
    vi.mocked(shouldAddScanResults).mockResolvedValueOnce(false);

    await scan(options, logger);

    const logMessage = vi.mocked(logger.log).mock.calls[0];

    expect(logMessage[0]).toContain(name);
    expect(logMessage[0]).toContain('Found unmanaged mod: ');
    expect(logMessage[1]).toBeTruthy(); //we log even when in quiet mode
  });

  it<LocalTestContext>('properly logs all found mods', async ({ options, logger }) => {
    const amountToGenerate = chance.integer({ min: 10, max: 30 });

    const results = [];
    for (let i = 0; i < amountToGenerate; i++) {
      results.push(generateScanResult().generated);
    }

    vi.mocked(scanLib).mockResolvedValueOnce(results);
    vi.mocked(shouldAddScanResults).mockResolvedValueOnce(false);

    await scan(options, logger);
    const logCalls = vi.mocked(logger.log).mock.calls;

    logCalls.forEach((call) => {
      expect(call[0]).toContain('Found unmanaged mod: ');
    });

    expect(vi.mocked(logger.log)).toHaveBeenCalledTimes(amountToGenerate);
  });

  it<LocalTestContext>('should add the new results', async (context) => {
    /**
     * Set up a config that has one mod and a corresponding install
     */
    const preexistingMod = generateModConfig().generated;
    const preexistingInstall = generateModInstall({
      type: preexistingMod.type,
      id: preexistingMod.id,
      name: preexistingMod.name
    }).generated;

    context.randomConfiguration.mods.push(preexistingMod);
    context.randomInstallations.push(preexistingInstall);

    /**
     * Create 3 scan results
     */
    const details1 = randomModDetails();
    const randomResult1 = generateScanResult(details1).generated;
    const details2 = randomModDetails();
    const randomResult2 = generateScanResult(details2).generated;
    const details3 = randomModDetails();
    const randomResult3 = generateScanResult(details3).generated;

    vi.mocked(scanLib).mockResolvedValueOnce([randomResult1, randomResult2, randomResult3]);
    vi.mocked(shouldAddScanResults).mockResolvedValueOnce(true);

    await scan(context.options, context.logger);

    expect(vi.mocked(writeConfigFile)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeLockFile)).toHaveBeenCalledOnce();

    const writtenConfig = vi.mocked(writeConfigFile).mock.calls[0][0];
    const writtenLock = vi.mocked(writeLockFile).mock.calls[0][0];

    expect(writtenConfig.mods).toContainEqual(preexistingMod);
    expect(writtenConfig.mods).toContainEqual({
      name: details1.name,
      id: details1.modId,
      type: details1.platform
    });
    expect(writtenConfig.mods).toContainEqual({
      name: details2.name,
      id: details2.modId,
      type: details2.platform
    });
    expect(writtenConfig.mods).toContainEqual({
      name: details3.name,
      id: details3.modId,
      type: details3.platform
    });

    expect(writtenLock).toContainEqual(preexistingInstall);
    expect(writtenLock).toContainEqual({
      downloadUrl: randomResult1.localDetails[0].mod.downloadUrl,
      fileName: randomResult1.localDetails[0].mod.fileName,
      hash: randomResult1.localDetails[0].mod.hash,
      id: details1.modId,
      name: details1.name,
      releasedOn: randomResult1.localDetails[0].mod.releaseDate,
      type: details1.platform
    });
    expect(writtenLock).toContainEqual({
      downloadUrl: randomResult2.localDetails[0].mod.downloadUrl,
      fileName: randomResult2.localDetails[0].mod.fileName,
      hash: randomResult2.localDetails[0].mod.hash,
      id: details2.modId,
      name: details2.name,
      releasedOn: randomResult2.localDetails[0].mod.releaseDate,
      type: details2.platform
    });
    expect(writtenLock).toContainEqual({
      downloadUrl: randomResult3.localDetails[0].mod.downloadUrl,
      fileName: randomResult3.localDetails[0].mod.fileName,
      hash: randomResult3.localDetails[0].mod.hash,
      id: details3.modId,
      name: details3.name,
      releasedOn: randomResult3.localDetails[0].mod.releaseDate,
      type: details3.platform
    });
  });

  describe('when there are unrecognizable files in the mods folder', () => {
    beforeEach(() => {
      vi.mocked(getModFiles).mockReset();
    });
    it<LocalTestContext>('logs things correctly no scan results but foreign files', async ({ options, logger }) => {
      const randomModName = chance.word();
      vi.mocked(scanLib).mockResolvedValueOnce([]);
      vi.mocked(getModFiles).mockResolvedValueOnce(['first-bad-mod-x', 'second-bad-mod-y', randomModName]);

      await scan(options, logger);
      const logCalls = vi.mocked(logger.log).mock.calls;

      expect(logCalls[0][0]).toMatchInlineSnapshot('"✅ Every mod that can be matched are managed by mmm."');
      expect(logCalls[1][0]).toMatchInlineSnapshot(`
        "
        The following files cannot be matched to any mod on any of the platforms:
        "
      `);
      expect(logCalls[2][0]).toMatchInlineSnapshot('"  ❌ first-bad-mod-x"');
      expect(logCalls[3][0]).toMatchInlineSnapshot('"  ❌ second-bad-mod-y"');
      expect(logCalls[4][0]).toContain(randomModName);
    });

    it<LocalTestContext>('logs things correctly with scan results and foreign files', async ({ options, logger }) => {
      const randomModName = chance.word();
      vi.mocked(scanLib).mockResolvedValueOnce([generateScanResult({ name: 'hi there' }).generated]);
      vi.mocked(shouldAddScanResults).mockResolvedValueOnce(false);
      vi.mocked(getModFiles).mockResolvedValueOnce(['first-bad-mod', 'second-bad-mod', randomModName]);

      await scan(options, logger);
      const logCalls = vi.mocked(logger.log).mock.calls;

      expect(logCalls[0][0]).toMatchInlineSnapshot('"✅Found unmanaged mod: hi there"');
      expect(logCalls[1][0]).toMatchInlineSnapshot(`
        "
        The following files cannot be matched to any mod on any of the platforms:
        "
      `);
      expect(logCalls[2][0]).toMatchInlineSnapshot('"  ❌ first-bad-mod"');
      expect(logCalls[3][0]).toMatchInlineSnapshot('"  ❌ second-bad-mod"');
      expect(logCalls[4][0]).toContain(randomModName);
    });
  });

  describe('when there are half-state files in the mods folder', () => {
    beforeEach(() => {
      vi.mocked(getModFiles).mockReset();
      vi.mocked(ensureConfiguration).mockReset();
      vi.mocked(readLockFile).mockReset();
    });

    it<LocalTestContext>('finds the files that it is unsure of', async ({ options, logger, randomConfiguration }) => {
      const modsDir = '/mods';

      const mod1name = 'mod1-name';
      const mod2name = 'mod2-name';
      const mod3name = 'mod3-name';
      const mod4name = 'mod4-name';

      const mod1 = generateModConfig({ name: mod1name }).generated;
      const mod2 = generateModConfig({ name: mod2name }).generated;
      const mod3 = generateModConfig({ name: mod3name }).generated;
      const mod4 = generateModConfig({ name: mod4name }).generated;

      randomConfiguration.mods = [mod1, mod2, mod3, mod4];
      randomConfiguration.modsFolder = modsDir;

      const mod1Install = generateModInstall({ type: mod1.type, id: mod1.id }).generated;
      const mod2Install = generateModInstall({ type: mod2.type, id: mod2.id }).generated;
      const mod3Install = generateModInstall({ type: mod3.type, id: mod3.id }).generated;

      const scanResults1 = generateScanResult({ name: mod1name, platform: mod1.type, modId: mod1.id }).generated;
      const scanResults2 = generateScanResult({ name: mod2name, platform: mod2.type, modId: mod2.id }).generated;
      const scanResults3 = generateScanResult({ name: mod3name, platform: mod3.type, modId: mod3.id }).generated;
      const scanResults4 = generateScanResult({ name: mod4name, platform: mod4.type, modId: mod4.id }).generated;

      /**
       * Mark mod2 legit, thus making mod1 and mod3 the only unsure file
       */
      scanResults2.localDetails[0].mod.hash = mod2Install.hash;

      vi.mocked(ensureConfiguration).mockResolvedValue(randomConfiguration);

      /**
       * Mod4 is not in the lockfile, thus it should be recognized as such
       */
      vi.mocked(readLockFile).mockResolvedValue([mod1Install, mod2Install, mod3Install]);
      scanResults4.localDetails[0].mod.fileName = 'mod4-local-filename';

      vi.mocked(scanLib).mockResolvedValueOnce([scanResults1, scanResults2, scanResults3, scanResults4]);
      vi.mocked(shouldAddScanResults).mockResolvedValueOnce(false);
      vi.mocked(getModFiles).mockResolvedValueOnce([
        path.resolve(modsDir, mod1Install.fileName),
        path.resolve(modsDir, mod2Install.fileName),
        path.resolve(modsDir, mod3Install.fileName),
        path.resolve(modsDir, scanResults4.localDetails[0].mod.fileName)
      ]);

      await scan(options, logger);
      const logCalls = vi.mocked(logger.log).mock.calls;

      expect(logCalls[0][0]).toMatchInlineSnapshot(
        '"❌ mod1-name has a different version locally than what is in the lockfile"'
      );
      expect(logCalls[1][0]).toMatchInlineSnapshot(
        '"❌ mod3-name has a different version locally than what is in the lockfile"'
      );
      expect(logCalls[2][0]).toMatchInlineSnapshot('"❌ mod4-name has a local file that isn\'t in the lockfile."');
    });

    it<LocalTestContext>('corrects the unsure ones', async ({ options, logger, randomConfiguration }) => {
      const modsDir = '/mods';

      const mod1name = 'mod1-name';
      const mod2name = 'mod2-name';

      const mod1 = generateModConfig({ name: mod1name }).generated;
      const mod2 = generateModConfig({ name: mod2name }).generated;

      randomConfiguration.mods = [mod1, mod2];
      randomConfiguration.modsFolder = modsDir;

      const mod1Install = generateModInstall({ type: mod1.type, id: mod1.id }).generated;
      const mod2Install = generateModInstall({ type: mod2.type, id: mod2.id }).generated;

      const scanResults1 = generateScanResult({ name: mod1name, platform: mod1.type, modId: mod1.id }).generated;
      const scanResults2 = generateScanResult({ name: mod2name, platform: mod2.type, modId: mod2.id }).generated;

      scanResults1.localDetails[0].mod.fileName = mod1Install.fileName;
      scanResults2.localDetails[0].mod.fileName = mod2Install.fileName;

      /**
       * Mark mod2 different hash, thus making mod1 and mod3 the only unsure file
       */
      scanResults2.localDetails[0].mod.hash = mod2Install.hash + chance.word();

      vi.mocked(ensureConfiguration).mockResolvedValue(randomConfiguration);

      /**
       * Mod1 is not in the lockfile, thus it should be recognized as such
       */
      vi.mocked(readLockFile).mockResolvedValue([mod2Install]);

      vi.mocked(scanLib).mockResolvedValueOnce([scanResults1, scanResults2]);
      vi.mocked(shouldAddScanResults).mockResolvedValueOnce(true);
      vi.mocked(getModFiles).mockResolvedValueOnce([
        path.resolve(modsDir, mod1Install.fileName),
        path.resolve(modsDir, mod2Install.fileName)
      ]);

      await scan(options, logger);
      const logCalls = vi.mocked(logger.log).mock.calls;

      expect(logCalls[2][0]).toMatchInlineSnapshot('"✅ Updated mod1-name to match the installed file"');
      expect(logCalls[3][0]).toMatchInlineSnapshot('"✅ Updated mod2-name to match the installed file"');

      const writtenInstallation = vi.mocked(writeLockFile).mock.calls[0][0];

      const expectedInstall = {
        hash: scanResults1.localDetails[0].mod.hash,
        fileName: scanResults1.localDetails[0].mod.fileName,
        name: scanResults1.allRemoteDetails[0].name,
        type: scanResults1.localDetails[0].platform,
        id: scanResults1.localDetails[0].modId,
        releasedOn: scanResults1.localDetails[0].mod.releaseDate,
        downloadUrl: scanResults1.localDetails[0].mod.downloadUrl
      };

      expect(writtenInstallation).toContainEqual(expectedInstall);
    });
  });

  it<LocalTestContext>('calls the correct telemetry', async ({ options, logger }) => {
    vi.mocked(scanLib).mockResolvedValueOnce([]);

    options.quiet = false;
    await scan(options, logger);

    expectCommandStartTelemetry({
      command: 'scan',
      success: true,
      duration: expect.any(Number),
      arguments: {
        options: options
      }
    });
  });

  it<LocalTestContext>('handles errors gracefully and continues scanning other mods', async ({ options, logger }) => {
    const name1 = chance.word();
    const name2 = chance.word();
    const randomResult1 = generateScanResult({ name: name1 }).generated;
    const randomResult2 = generateScanResult({ name: name2 }).generated;

    vi.mocked(scanLib).mockResolvedValueOnce([randomResult1, randomResult2]);
    vi.mocked(shouldAddScanResults).mockResolvedValueOnce(false);

    await scan(options, logger);

    const logMessages = vi.mocked(logger.log).mock.calls;

    expect(logMessages[0][0]).toContain(name1);
    expect(logMessages[0][0]).toContain('Found unmanaged mod: ');
    expect(logMessages[1][0]).toContain(name2);
    expect(logMessages[1][0]).toContain('Found unmanaged mod: ');
  });

  it<LocalTestContext>('updates the configuration and lock files correctly for all found mods', async (context) => {
    const preexistingMod = generateModConfig().generated;
    const preexistingInstall = generateModInstall({
      type: preexistingMod.type,
      id: preexistingMod.id,
      name: preexistingMod.name
    }).generated;

    context.randomConfiguration.mods.push(preexistingMod);
    context.randomInstallations.push(preexistingInstall);

    const details1 = randomModDetails();
    const randomResult1 = generateScanResult(details1).generated;
    const details2 = randomModDetails();
    const randomResult2 = generateScanResult(details2).generated;

    vi.mocked(scanLib).mockResolvedValueOnce([randomResult1, randomResult2]);
    vi.mocked(shouldAddScanResults).mockResolvedValueOnce(true);

    await scan(context.options, context.logger);

    expect(vi.mocked(writeConfigFile)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeLockFile)).toHaveBeenCalledOnce();

    const writtenConfig = vi.mocked(writeConfigFile).mock.calls[0][0];
    const writtenLock = vi.mocked(writeLockFile).mock.calls[0][0];

    expect(writtenConfig.mods).toContainEqual(preexistingMod);
    expect(writtenConfig.mods).toContainEqual({
      name: details1.name,
      id: details1.modId,
      type: details1.platform
    });
    expect(writtenConfig.mods).toContainEqual({
      name: details2.name,
      id: details2.modId,
      type: details2.platform
    });

    expect(writtenLock).toContainEqual(preexistingInstall);
    expect(writtenLock).toContainEqual({
      downloadUrl: randomResult1.localDetails[0].mod.downloadUrl,
      fileName: randomResult1.localDetails[0].mod.fileName,
      hash: randomResult1.localDetails[0].mod.hash,
      id: details1.modId,
      name: details1.name,
      releasedOn: randomResult1.localDetails[0].mod.releaseDate,
      type: details1.platform
    });
    expect(writtenLock).toContainEqual({
      downloadUrl: randomResult2.localDetails[0].mod.downloadUrl,
      fileName: randomResult2.localDetails[0].mod.fileName,
      hash: randomResult2.localDetails[0].mod.hash,
      id: details2.modId,
      name: details2.name,
      releasedOn: randomResult2.localDetails[0].mod.releaseDate,
      type: details2.platform
    });
  });

  it<LocalTestContext>('logs detailed error messages for debugging purposes', async ({ options, logger }) => {
    const error = new Error('Test error');
    vi.mocked(scanLib).mockRejectedValueOnce(error);

    await expect(scan(options, logger)).rejects.toThrow('process.exit');

    expect(logger.error).toHaveBeenCalledWith(error.message, 2);
  });
});
