import { RemoteModDetails, Platform, ReleaseType } from '../../lib/modlist.types.js';
import { version } from '../../version.js';
import { modrinthApiKey } from '../../env.js';
import { CouldNotFindModException } from '../../errors/CouldNotFindModException.js';
import { NoFileFound } from '../../errors/NoFileFound.js';

interface Hash {
  sha1: string;
  sha512: string;
}

interface ModrinthFile {
  hashes: Hash;
  url: string;
  filename: string;
}

interface ModrinthVersion {
  name: string;
  loaders: string[];
  game_versions: string[];
  date_published: string;
  version_type: ReleaseType;
  files: ModrinthFile[];
}

const apiHeaders = {
  'user-agent': `github_com/meza/minecraft-mod-manager/${version}`,
  'Accept': 'application/json',
  'Authorization': modrinthApiKey
};

const getName = async (projectId: string): Promise<string> => {
  const url = `https://api.modrinth.com/v2/project/${projectId}`;
  const modDetailsRequest = await fetch(url, {
    headers: apiHeaders
  });

  if (modDetailsRequest.status !== 200) {
    throw new CouldNotFindModException(projectId, Platform.MODRINTH);
  }

  const modDetails = await modDetailsRequest.json();
  return modDetails.title;
};

export const getMod = async (
  projectId: string,
  allowedReleaseTypes: ReleaseType[],
  allowedGameVersion: string,
  loader: string,
  allowFallback: boolean): Promise<RemoteModDetails> => {
  const url = `https://api.modrinth.com/v2/project/${projectId}/version`;

  const modDetailsRequest = await fetch(url, {
    headers: apiHeaders
  });

  if (modDetailsRequest.status !== 200) {
    throw new CouldNotFindModException(projectId, Platform.MODRINTH);
  }

  const modVersions = await modDetailsRequest.json() as ModrinthVersion[];

  const potentialFiles = modVersions
    .filter((version) => {
      return version.loaders.map((origLoader: string) => origLoader.toLowerCase()).includes(loader.toLowerCase());
    })
    .filter((version) => {
      const hasPerfectMatch = version.game_versions.includes(allowedGameVersion);
      if (!hasPerfectMatch && allowFallback) {
        const gameVersionsWithOnlyMajorAndMinor = version.game_versions.map((gameVersion) => {
          const [major, minor] = gameVersion.split('.');
          return `${major}.${minor}`;
        });

        const [major, minor] = allowedGameVersion.split('.');

        return gameVersionsWithOnlyMajorAndMinor.includes(`${major}.${minor}`);
      }
      return hasPerfectMatch;
    })
    .filter((version) => {
      return allowedReleaseTypes.includes(version.version_type);
    })
    .sort((a, b) => {
      return a.date_published < b.date_published ? 1 : -1;
    })
  ;

  if (potentialFiles.length === 0) {
    throw new NoFileFound(projectId, Platform.MODRINTH);
  }

  const latestFile = potentialFiles[0];

  const modData: RemoteModDetails = {
    name: await getName(projectId),
    fileName: latestFile.files[0].filename,
    releaseDate: latestFile.date_published,
    hash: latestFile.files[0].hashes.sha1,
    downloadUrl: latestFile.files[0].url
  };

  return modData;
};
