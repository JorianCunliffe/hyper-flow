import {
  readArtifactRecord,
  listArtifactRecords,
  transactArtifactRecord,
} from "../serverStore.js";
import type { ArtifactJob, ArtifactRegistry } from "./model.js";
export interface ArtifactFile {
  base64: string;
  sha256: string;
  receipt: NonNullable<ArtifactJob["receipt"]>;
}
export interface ArtifactStore {
  read<T>(
    org: string,
    kind: "jobs" | "registries" | "files",
    id: string,
  ): Promise<T | null>;
  list(org: string): Promise<ArtifactJob[]>;
  transact<T>(
    org: string,
    kind: "jobs" | "registries" | "files",
    id: string,
    update: (current: T | null) => T,
  ): Promise<T>;
}
export const artifactStore: ArtifactStore = {
  read: readArtifactRecord,
  list: listArtifactRecords,
  transact: transactArtifactRecord,
};
