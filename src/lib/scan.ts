import curseforge from '@meza/curseforge-fingerprint';
import { ScanResults } from '../actions/scan.js';
import { CurseforgeDownloadUrlError } from '../errors/CurseforgeDownloadUrlError.js';
import { NoRemoteFileFound } from '../errors/NoRemoteFileFound.js';
import { LookupInput, ResultItem, fetchModDetails, lookup } from '../repositories/index.js';
import { Modrinth } from '../repositories/modrinth/index.js';
import { fileIsManaged } from './configurationHelper.js';
import { getModFiles } from './fileHelper.js';
import { getHash } from './hash.js';
import { ModInstall, ModsJson, Platform } from './modlist.types.js';

const getScanResults = async (files: string[], installations: ModInstall[]) => {
  const cfInput: LookupInput = {
    platform: Platform.CURSEFORGE,
    hash: []
  };
  const modrinthInput: LookupInput = {
    platform: Platform.MODRINTH,
    hash: []
  };
  let found = 0;
  const all = files.map(async (filePath) => {
    if (fileIsManaged(filePath, installations)) {
      return;
    }
    found++;
    try {
      const fingerprint = curseforge.fingerprint(filePath);
      cfInput.hash.push(String(fingerprint));
    } catch (_) {
      //ignore
    }
    const fileSha1Hash = await getHash(filePath, Modrinth.PREFERRED_HASH);
    modrinthInput.hash.push(fileSha1Hash);
  });

  await Promise.all(all);
  if (found === 0) {
    return [];
  }

  const lookupResults: ResultItem[] = await lookup([cfInput, modrinthInput]);
  return lookupResults;
};

export const scanFiles = async (
  files: string[],
  installations: ModInstall[],
  prefer: Platform,
  configuration: ModsJson
) => {
  performance.mark('lib-scan-start');
  const lookupResults = await getScanResults(files, installations);

  const normalizers: Promise<ScanResults>[] = [];

  const normalizeResults = async (lookupResult: ResultItem): Promise<ScanResults> => {
    lookupResult.hits.sort((hit1, hit2) => {
      if (hit1.platform === prefer && hit2.platform !== prefer) {
        // there can't be 2 identical hits from the same platform
        return -1;
      }
      return 1;
    });

    const allDetails = [];

    for (let i = 0; i < lookupResult.hits.length; i++) {
      try {
        const deets = await fetchModDetails(
          lookupResult.hits[i].platform,
          lookupResult.hits[i].modId,
          configuration.defaultAllowedReleaseTypes,
          configuration.gameVersion,
          configuration.loader,
          false //TODO: Figure out how to handle this. Should scan allow fallback? Does it even matter? What's the logic here?
        );

        allDetails[i] = deets;
      } catch (error) {
        if (!(error instanceof CurseforgeDownloadUrlError || error instanceof NoRemoteFileFound)) {
          // Edge case for a freak Curseforge bug and the no remote file
          console.error(`Error fetching mod details for ${lookupResult.hits[i].modId} on ${lookupResult.hits[i].platform}: ${error.message}`);
          continue; // Skip problematic mods
        }
        console.error(`Error fetching mod details for ${lookupResult.hits[i].modId} on ${lookupResult.hits[i].platform}: ${error.message}`);
      }
    }

    const finalDetails = allDetails.filter((deets) => deets !== undefined);

    performance.mark('lib-scan-end');
    performance.measure('lib-scan', 'lib-scan-start', 'lib-scan-end');

    return {
      preferredDetails: finalDetails[0],
      allRemoteDetails: finalDetails,
      localDetails: lookupResult.hits
    };
  };

  lookupResults.forEach((lookupResult) => {
    normalizers.push(normalizeResults(lookupResult));
  });

  const normalizedResults = await Promise.allSettled(normalizers);

  const result: ScanResults[] = [];
  normalizedResults.forEach((normalizeResult) => {
    if (normalizeResult.status === 'rejected') {
      console.error(`Error normalizing results: ${normalizeResult.reason}`);
      return;
    }

    result.push(normalizeResult.value);
  });

  return result;
};

export const scan = async (
  configLocation: string,
  prefer: Platform,
  configuration: ModsJson,
  installations: ModInstall[]
) => {
  const files = await getModFiles(configLocation, configuration);
  return scanFiles(files, installations, prefer, configuration);
};
