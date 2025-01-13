import curseforge from '@meza/curseforge-fingerprint';
import { chance } from 'jest-chance';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePlatformLookupResult } from '../../test/generatePlatformLookupResult.js';
import { generateRandomPlatform } from '../../test/generateRandomPlatform.js';
import { generateRemoteModDetails } from '../../test/generateRemoteDetails.js';
import { generateResultItem } from '../../test/generateResultItem.js';
import { generateModsJson } from '../../test/modlistGenerator.js';
import { CurseforgeDownloadUrlError } from '../errors/CurseforgeDownloadUrlError.js';
import { NoRemoteFileFound } from '../errors/NoRemoteFileFound.js';
import { fetchModDetails, lookup } from '../repositories/index.js';
import { fileIsManaged } from './configurationHelper.js';
import { getModFiles } from './fileHelper.js';
import { getHash } from './hash.js';
import { ModInstall, ModsJson, Platform } from './modlist.types.js';
import { scan, scanFiles } from './scan.js';

vi.mock('./fileHelper.js');
vi.mock('./hash.js');
vi.mock('@meza/curseforge-fingerprint');
vi.mock('./configurationHelper.js');
vi.mock('../repositories/index.js');

interface LocalTestContext {
  randomConfiguration: ModsJson;
  randomInstallations: ModInstall[];
  randomPlatform: Platform;
  config: 'config.json';
}

describe('The scan library', () => {
  beforeEach<LocalTestContext>((context) => {
    vi.resetAllMocks();
    context.randomConfiguration = generateModsJson().generated;
    context.randomInstallations = [];
    context.randomPlatform = generateRandomPlatform();
  });

  describe('when there are no files in the mods folder', () => {
    it<LocalTestContext>('returns an empty array', async (context) => {
      const randomModsFolder = chance.word();
      context.randomConfiguration.modsFolder = randomModsFolder;

      vi.mocked(getModFiles).mockResolvedValueOnce([]);
      vi.mocked(lookup).mockResolvedValueOnce([]);

      const actual = await scan(
        context.config,
        context.randomPlatform,
        context.randomConfiguration,
        context.randomInstallations
      );

      expect(actual).toEqual([]);
      expect(vi.mocked(getModFiles)).toHaveBeenCalledWith(context.config, context.randomConfiguration);
    });
  });

  describe('when all files are managed', () => {
    it<LocalTestContext>('returns an empty array', async (context) => {
      vi.mocked(getModFiles).mockResolvedValueOnce(chance.n(chance.word, chance.integer({ min: 5, max: 50 })));
      vi.mocked(fileIsManaged).mockReturnValue(true);

      const actual = await scan(
        context.config,
        context.randomPlatform,
        context.randomConfiguration,
        context.randomInstallations
      );

      expect(actual).toEqual([]);
    });
  });

  describe('when there are unmanaged files in the mods folder', () => {
    it<LocalTestContext>('passes the correct inputs to the hashing functions', async (context) => {
      const randomModsFolder = 'mods-folder';
      const randomFileName = chance.word();
      const randomHash = chance.hash();
      const randomFingerprint = chance.integer({ min: 6, max: 6 });
      const expectedPath = randomFileName;

      context.randomConfiguration.modsFolder = randomModsFolder;
      vi.mocked(getModFiles).mockResolvedValueOnce([randomFileName]);
      vi.mocked(fileIsManaged).mockReturnValueOnce(false); // non-managed path
      vi.mocked(curseforge.fingerprint).mockReturnValueOnce(randomFingerprint);
      vi.mocked(getHash).mockResolvedValueOnce(randomHash);

      vi.mocked(lookup).mockResolvedValueOnce([]); // we don't care about the return just yet

      await scan(context.config, context.randomPlatform, context.randomConfiguration, context.randomInstallations);

      //expectations
      // do we call the curseforge fingerprint with the correct values?
      expect(curseforge.fingerprint).toHaveBeenCalledOnce();
      expect(curseforge.fingerprint).toHaveBeenCalledWith(expectedPath); // whatever comes from the getModFiles

      // do we call the modrinth hasher with the correct values?
      expect(getHash).toHaveBeenCalledOnce();
      expect(getHash).toHaveBeenCalledWith(expectedPath, 'sha1');

      expect(vi.mocked(lookup)).toHaveBeenCalledWith([
        {
          platform: Platform.CURSEFORGE,
          hash: [randomFingerprint.toString()]
        },
        {
          platform: Platform.MODRINTH,
          hash: [randomHash]
        }
      ]);
    });

    it<LocalTestContext>('handles curseforge dying well', async (context) => {
      const randomModsFolder = 'mods-folder';
      const randomFileName = chance.word();
      const randomHash = chance.hash();
      const expectedPath = randomFileName;

      context.randomConfiguration.modsFolder = randomModsFolder;
      vi.mocked(getModFiles).mockResolvedValueOnce([randomFileName]);
      vi.mocked(fileIsManaged).mockReturnValueOnce(false); // non-managed path
      vi.mocked(curseforge.fingerprint).mockImplementation(() => {
        throw new Error('test-error');
      });

      vi.mocked(getHash).mockResolvedValueOnce(randomHash);

      vi.mocked(lookup).mockResolvedValueOnce([]); // we don't care about the return just yet

      await scan(context.config, context.randomPlatform, context.randomConfiguration, context.randomInstallations);

      //expectations
      // do we call the curseforge fingerprint with the correct values?
      expect(curseforge.fingerprint).toHaveBeenCalledOnce();
      expect(curseforge.fingerprint).toHaveBeenCalledWith(expectedPath); // whatever comes from the getModFiles

      expect(vi.mocked(lookup)).toHaveBeenCalledWith([
        {
          hash: [],
          platform: Platform.CURSEFORGE
        },
        {
          platform: Platform.MODRINTH,
          hash: [randomHash]
        }
      ]);
    });

    it<LocalTestContext>('passes the correct inputs to the lookup', async (context) => {
      const randomFileName = chance.word();
      const randomHash = chance.hash();
      const randomFingerprint = chance.integer({ min: 6, max: 6 });

      vi.mocked(getModFiles).mockResolvedValueOnce([randomFileName]);
      vi.mocked(fileIsManaged).mockReturnValueOnce(false); // non-managed path
      vi.mocked(curseforge.fingerprint).mockReturnValueOnce(randomFingerprint);
      vi.mocked(getHash).mockResolvedValueOnce(randomHash);

      vi.mocked(lookup).mockResolvedValueOnce([]); // we don't care about the return just yet

      await scan(context.config, context.randomPlatform, context.randomConfiguration, context.randomInstallations);

      const lookupArgs = vi.mocked(lookup).mock.calls[0][0];

      expect(lookupArgs).toContainEqual({
        platform: Platform.CURSEFORGE,
        hash: [randomFingerprint.toString()]
      });
      expect(lookupArgs).toContainEqual({
        platform: Platform.MODRINTH,
        hash: [randomHash]
      });
    });

    describe('and the preferred platform has no results', () => {
      const preferredPlatform = Platform.MODRINTH;
      const notThePreferredPlatform = Platform.CURSEFORGE;

      it<LocalTestContext>('returns the first hits', async (context) => {
        const modId = chance.word();
        const expectedModDetails = generateRemoteModDetails({}).generated;
        const expectedHit = generatePlatformLookupResult({
          modId: modId,
          mod: expectedModDetails,
          platform: notThePreferredPlatform
        }).generated;
        const notExpectedHit = generatePlatformLookupResult({ platform: notThePreferredPlatform }).generated;
        const lookupResult = generateResultItem({
          hits: [expectedHit, notExpectedHit]
        }).generated;

        vi.mocked(getModFiles).mockResolvedValueOnce([chance.word()]); // we don't care about the files
        vi.mocked(fetchModDetails).mockResolvedValueOnce(expectedModDetails);
        vi.mocked(lookup).mockResolvedValueOnce([lookupResult]);

        const actual = await scan(
          context.config,
          preferredPlatform,
          context.randomConfiguration,
          context.randomInstallations
        );

        expect(actual[0].preferredDetails).toBe(expectedModDetails);
        expect(actual[0].localDetails[0]).toBe(expectedHit);
        expect(actual[0].allRemoteDetails[0]).toBe(expectedModDetails);
      });
    });

    describe('and the preferred platform has results', () => {
      const preferredPlatform = Platform.MODRINTH;
      const notThePreferredPlatform = Platform.CURSEFORGE;

      it<LocalTestContext>('returns the preferred platform results', async (context) => {
        const modId = chance.word();
        const expectedModDetails = generateRemoteModDetails().generated;
        const preferredHit = generatePlatformLookupResult({
          modId: modId,
          mod: expectedModDetails,
          platform: preferredPlatform
        }).generated;
        const notPreferredHit = generatePlatformLookupResult({ platform: notThePreferredPlatform }).generated;
        const lookupResult = generateResultItem({
          hits: [notPreferredHit, preferredHit]
        }).generated;

        vi.mocked(getModFiles).mockResolvedValueOnce([chance.word()]); // we don't care about the files
        vi.mocked(fetchModDetails).mockResolvedValueOnce(expectedModDetails);
        vi.mocked(lookup).mockResolvedValueOnce([lookupResult]);

        const actual = await scan(
          context.config,
          preferredPlatform,
          context.randomConfiguration,
          context.randomInstallations
        );

        expect(actual[0].preferredDetails).toBe(expectedModDetails);
        expect(actual[0].allRemoteDetails[0]).toBe(expectedModDetails);
        expect(actual[0].localDetails[0]).toBe(preferredHit);
      });

      it<LocalTestContext>('adds all results to the response', async (context) => {
        const modId1 = chance.word();
        const modId2 = chance.word();
        const preferredModDetails = generateRemoteModDetails().generated;
        const notPreferredModDetails = generateRemoteModDetails().generated;
        const preferredHit = generatePlatformLookupResult({
          modId: modId1,
          mod: preferredModDetails,
          platform: preferredPlatform
        }).generated;
        const notPreferredHit = generatePlatformLookupResult({
          modId: modId2,
          mod: notPreferredModDetails,
          platform: notThePreferredPlatform
        }).generated;
        const lookupResult = generateResultItem({
          hits: [notPreferredHit, preferredHit]
        }).generated;

        vi.mocked(getModFiles).mockResolvedValueOnce([chance.word()]); // we don't care about the files
        vi.mocked(fetchModDetails).mockResolvedValueOnce(preferredModDetails);
        vi.mocked(fetchModDetails).mockResolvedValueOnce(notPreferredModDetails);
        vi.mocked(lookup).mockResolvedValueOnce([lookupResult]);

        const actual = await scan(
          context.config,
          preferredPlatform,
          context.randomConfiguration,
          context.randomInstallations
        );

        // Assess if the sorting worked.
        // The preferred mod should be resolved first
        const fetchCalls = vi.mocked(fetchModDetails).mock.calls;
        expect(fetchModDetails).toHaveBeenCalledTimes(2);
        expect(fetchCalls[0][0]).toEqual(preferredHit.platform);
        expect(fetchCalls[0][1]).toEqual(preferredHit.modId);
        expect(fetchCalls[1][0]).toEqual(notPreferredHit.platform);
        expect(fetchCalls[1][1]).toEqual(notPreferredHit.modId);

        // Assess the result
        expect(actual[0].preferredDetails).toBe(preferredModDetails);
        expect(actual[0].allRemoteDetails[0]).toBe(preferredModDetails);
        expect(actual[0].allRemoteDetails[1]).toBe(notPreferredModDetails);
        expect(actual[0].localDetails[0]).toBe(preferredHit);
        expect(actual[0].localDetails[1]).toBe(notPreferredHit);
      });
    });

    describe('and the mod details cannot be fetched', () => {
      it<LocalTestContext>('skips the mods in error for the curseforge bug', async (context) => {
        const randomModId = chance.word();
        const randomPlatform = generateRandomPlatform();
        const lookupResult = generateResultItem({
          hits: [
            generatePlatformLookupResult({
              modId: randomModId,
              platform: randomPlatform
            }).generated
          ]
        }).generated;

        vi.mocked(getModFiles).mockResolvedValueOnce([chance.word()]); // we don't care about the files
        vi.mocked(fetchModDetails).mockRejectedValueOnce(new CurseforgeDownloadUrlError(randomModId));
        vi.mocked(lookup).mockResolvedValueOnce([lookupResult]);

        const actual = await scan(
          context.config,
          context.randomPlatform,
          context.randomConfiguration,
          context.randomInstallations
        );

        expect(actual).toEqual([
          {
            preferredDetails: undefined,
            allRemoteDetails: [],
            localDetails: lookupResult.hits
          }
        ]);
      });

      it<LocalTestContext>('skips the mods in error for general mod not found ', async (context) => {
        const randomModId = chance.word();
        const randomPlatform = generateRandomPlatform();
        const lookupResult = generateResultItem({
          hits: [
            generatePlatformLookupResult({
              modId: randomModId,
              platform: randomPlatform
            }).generated
          ]
        }).generated;

        vi.mocked(getModFiles).mockResolvedValueOnce([chance.word()]); // we don't care about the files
        vi.mocked(fetchModDetails).mockRejectedValueOnce(new NoRemoteFileFound(randomModId, randomPlatform));
        vi.mocked(lookup).mockResolvedValueOnce([lookupResult]);

        const actual = await scan(
          context.config,
          context.randomPlatform,
          context.randomConfiguration,
          context.randomInstallations
        );

        expect(actual).toEqual([
          {
            preferredDetails: undefined,
            allRemoteDetails: [],
            localDetails: lookupResult.hits
          }
        ]);
      });
    });

    describe('and the mod details fetching dies to an error', () => {
      it<LocalTestContext>('skips the mods in error', async (context) => {
        const lookupResult = generateResultItem({
          hits: [generatePlatformLookupResult().generated]
        }).generated;

        vi.mocked(getModFiles).mockResolvedValueOnce([chance.word()]); // we don't care about the files
        vi.mocked(fetchModDetails).mockRejectedValueOnce(new Error('test-error'));
        vi.mocked(lookup).mockResolvedValueOnce([lookupResult]);

        const actual = await scan(
          context.config,
          context.randomPlatform,
          context.randomConfiguration,
          context.randomInstallations
        );

        expect(actual).toEqual([]);
      });
    });
  });

  describe('scanFiles function', () => {
    it('handles errors gracefully and skips problematic mods', async () => {
      const files = [chance.word()];
      const installations: ModInstall[] = [];
      const prefer = Platform.MODRINTH;
      const configuration = generateModsJson().generated;

      vi.mocked(getHash).mockRejectedValueOnce(new Error('Test error'));

      const result = await scanFiles(files, installations, prefer, configuration);

      expect(result).toEqual([]);
    });

    it('logs detailed error messages for debugging purposes', async () => {
      const files = [chance.word()];
      const installations: ModInstall[] = [];
      const prefer = Platform.MODRINTH;
      const configuration = generateModsJson().generated;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(getHash).mockRejectedValueOnce(new Error('Test error'));

      await scanFiles(files, installations, prefer, configuration);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error fetching mod details'));
      consoleErrorSpy.mockRestore();
    });

    it('returns an empty array when there are no files in the mods folder or all files are managed', async () => {
      const files: string[] = [];
      const installations: ModInstall[] = [];
      const prefer = Platform.MODRINTH;
      const configuration = generateModsJson().generated;

      const result = await scanFiles(files, installations, prefer, configuration);

      expect(result).toEqual([]);
    });
  });
});
