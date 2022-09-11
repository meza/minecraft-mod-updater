import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { add } from './add.js';
import { ModDetails, ModlistConfig, Platform } from '../lib/modlist.types.js';
import { readConfigFile, writeConfigFile } from '../lib/config.js';
import { fetchModDetails } from '../repositories/index.js';
import { downloadFile } from '../lib/downloader.js';
import { generateModlist } from '../../test/modlistGenerator.js';
import { generateModDetails } from '../../test/modDetailsGenerator.js';
import { GeneratorResult } from '../../test/test.types.js';
import { chance } from 'jest-chance';
import { generateModConfig } from '../../test/modConfigGenerator.js';
import { UnknownPlatformException } from '../errors/UnknownPlatformException.js';
import inquirer from 'inquirer';

vi.mock('../lib/config.js');
vi.mock('../repositories/index.js');
vi.mock('../lib/downloader.js');
vi.mock('inquirer');

interface LocalTestContext {
  randomConfiguration: GeneratorResult<ModlistConfig>;
  randomModDetails: GeneratorResult<ModDetails>;
}

const assumeDownloadIsSuccessful = () => {
  vi.mocked(downloadFile).mockResolvedValueOnce();
};

const assumeWrongPlatform = (override?: string) => {
  const randomPlatform = override || chance.word();
  vi.mocked(fetchModDetails).mockReset();
  vi.mocked(fetchModDetails).mockRejectedValueOnce(new UnknownPlatformException(randomPlatform));
  return randomPlatform;
};

describe('The add module', async () => {
  beforeEach<LocalTestContext>((context) => {
    context.randomConfiguration = generateModlist();

    // the main configuration to work with
    vi.mocked(readConfigFile).mockResolvedValue(context.randomConfiguration.generated);

    // the mod details returned from the repository
    context.randomModDetails = generateModDetails();
    vi.mocked(fetchModDetails).mockResolvedValueOnce(context.randomModDetails.generated);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it<LocalTestContext>('should add a mod to the configuration', async (
    { randomConfiguration, randomModDetails }
  ) => {

    const randomPlatform = chance.pickone(['fabric', 'forge']);
    const randomModId = chance.word();

    assumeDownloadIsSuccessful();

    await add(randomPlatform, randomModId, { config: 'config.json' });

    expect(
      vi.mocked(readConfigFile),
      'did not read the configuration file'
    ).toHaveBeenCalledTimes(1);

    expect(
      vi.mocked(fetchModDetails),
      'fetching the mod details during adding didn\'t happen'
    ).toHaveBeenCalledTimes(1);

    const expectedConfiguration = {
      ...randomConfiguration.expected,
      mods: [
        {
          type: randomPlatform,
          id: randomModId,
          name: randomModDetails.expected.name,
          installed: {
            fileName: randomModDetails.expected.fileName,
            releasedOn: randomModDetails.expected.releaseDate,
            hash: randomModDetails.expected.hash
          },
          allowedReleaseTypes: randomConfiguration.expected.defaultAllowedReleaseTypes
        }
      ]
    };

    expect(
      vi.mocked(writeConfigFile),
      'Writing the configuration file after adding a mod has failes'
    ).toHaveBeenCalledWith(expectedConfiguration, 'config.json');

  });

  it<LocalTestContext>('should skip the download if the mod already exists', async (context) => {
    const randomPlatform = chance.pickone(Object.values(Platform));
    const randomModId = chance.word();

    const randomModDetails = generateModConfig({
      type: randomPlatform,
      id: randomModId
    });

    context.randomConfiguration.generated.mods = [randomModDetails.generated];

    await add(randomPlatform, randomModId, { config: 'config.json' });

    expect(
      vi.mocked(fetchModDetails),
      'Fetched the mod details even though the mod already exists'
    ).toHaveBeenCalledTimes(0);

    expect(
      vi.mocked(downloadFile),
      'The download was called even though the mod already exists'
    ).toHaveBeenCalledTimes(0);
  });

  it<LocalTestContext>('should not show a debug message when it is not asked for', async (context) => {
    const consoleSpy = vi.spyOn(console, 'debug');

    const randomPlatform = Platform.CURSEFORGE;
    const randomModId = 'a-mod-id';
    const isDebug = false;

    const randomModDetails = generateModConfig({
      type: randomPlatform,
      id: randomModId
    });

    context.randomConfiguration.generated.mods = [randomModDetails.generated];

    await add(randomPlatform, randomModId, { config: 'config.json', debug: isDebug });

    expect(
      consoleSpy,
      'The debug message was not logged'
    ).not.toHaveBeenCalled();
  });

  it<LocalTestContext>('should show a debug message when it is not asked for', async (context) => {
    const consoleSpy = vi.spyOn(console, 'debug');

    const randomPlatform = Platform.MODRINTH;
    const randomModId = 'another-mod-id';
    const isDebug = true;

    const randomModDetails = generateModConfig({
      type: randomPlatform,
      id: randomModId
    });

    context.randomConfiguration.generated.mods = [randomModDetails.generated];

    await add(randomPlatform, randomModId, { config: 'config.json', debug: isDebug });

    expect(
      consoleSpy,
      'The debug message was not logged'
    ).toHaveBeenCalledWith('Mod another-mod-id for modrinth already exists in the configuration');
  });

  describe('when an incorrect platform is chosen in interactive mode', async () => {
    describe('and the user chooses to cancel', async () => {
      it('it should exit after the prompt', async () => {
        const wrongPlatformText = assumeWrongPlatform();
        const randomModId = chance.word();

        vi.mocked(inquirer.prompt).mockResolvedValueOnce({ platform: 'cancel' });

        await add(wrongPlatformText, randomModId, { config: 'config.json' });

        // @ts-ignore anyone with a fix for this?
        const inquirerOptions = vi.mocked(inquirer.prompt).mock.calls[0][0][0];

        expect(inquirerOptions.choices.sort()).toEqual(['cancel', ...Object.values(Platform)].sort());
        expect(vi.mocked(inquirer.prompt)).toHaveBeenCalledTimes(1);

        // These mean that the add hasn't been recursively called
        expect(vi.mocked(readConfigFile)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(fetchModDetails)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(downloadFile)).not.toHaveBeenCalled();
      });
    });

    describe('and the user chooses an alternative option', async () => {
      it<LocalTestContext>('it should call add again with the new platform', async (context) => {
        const randomModId = chance.word();

        // 1st invocation fails
        const wrongPlatformText = assumeWrongPlatform();

        // we select a correct platform through the prompt
        const randomPlatform = chance.pickone(Object.values(Platform));
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({ platform: randomPlatform });

        // upon 2nd invocation of the fetch, return a correct response
        vi.mocked(fetchModDetails).mockResolvedValueOnce(context.randomModDetails.generated);

        // we assume that the download is successful
        assumeDownloadIsSuccessful();

        await add(wrongPlatformText, randomModId, { config: 'config.json' });

        expect(vi.mocked(downloadFile)).toHaveBeenCalledWith(
          context.randomModDetails.generated.downloadUrl,
          expect.any(String)
        );

        // make sure we save with the correct platform
        const actualConfiguration = vi.mocked(writeConfigFile).mock.calls[0][0];
        expect(actualConfiguration.mods[0].type).toEqual(randomPlatform);

        // validate our assumptions about how many times things have been called
        expect(vi.mocked(downloadFile)).toHaveBeenCalledOnce();
        expect(vi.mocked(fetchModDetails)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(readConfigFile)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(writeConfigFile)).toHaveBeenCalledTimes(1);

      });
    });
  });

  describe('when an incorrect platform is chosen in quiet mode', async () => {
    it('it should exit after an error message has been shown', async () => {
      const wrongPlatformText = assumeWrongPlatform('very-wrong-platform');
      const randomModId = chance.word();

      const consoleSpy = vi.spyOn(console, 'error');
      consoleSpy.mockImplementation(() => {});

      await add(wrongPlatformText, randomModId, { config: 'config.json', quiet: true });

      // did we notify the user?
      const consoleError = consoleSpy.mock.calls[0][0];
      expect(consoleError).toEqual('Unknown platform "very-wrong-platform". Please use one of the following: curseforge, modrinth');

      // These mean that the add hasn't been recursively called
      expect(vi.mocked(readConfigFile)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetchModDetails)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(downloadFile)).not.toHaveBeenCalled();
    });
  });

});
