/**
 * Boundary between the app and the PSN integration. The production implementation
 * calls Rust commands (which hold the tokens); tests inject fakes. Responses are raw,
 * unvalidated JSON and must go through `schemas.ts` before use.
 */
import { invoke } from "@tauri-apps/api/core";
import type { NpServiceName } from "../domain/types";

export interface PsnConnectionStatus {
  connected: boolean;
  needsReauth: boolean;
  connectedAt: number | null;
  refreshExpiresAt: number | null;
}

export interface PsnGateway {
  status(): Promise<PsnConnectionStatus>;
  connect(npsso: string): Promise<PsnConnectionStatus>;
  disconnect(): Promise<void>;
  /** Own profile + trophy level (read-only). */
  ownProfile(): Promise<unknown>;
  userTitles(): Promise<unknown[]>;
  titleTrophies(npCommunicationId: string, service: NpServiceName): Promise<unknown>;
  titleTrophyGroups(npCommunicationId: string, service: NpServiceName): Promise<unknown>;
  userEarned(npCommunicationId: string, service: NpServiceName): Promise<unknown>;
}

export const tauriPsnGateway: PsnGateway = {
  status: () => invoke("psn_status"),
  connect: (npsso) => invoke("psn_connect", { npsso }),
  disconnect: () => invoke("psn_disconnect"),
  ownProfile: () => invoke("psn_own_profile"),
  userTitles: () => invoke("psn_user_titles"),
  titleTrophies: (npCommunicationId, service) =>
    invoke("psn_title_trophies", { npCommunicationId, npServiceName: service }),
  titleTrophyGroups: (npCommunicationId, service) =>
    invoke("psn_title_trophy_groups", { npCommunicationId, npServiceName: service }),
  userEarned: (npCommunicationId, service) => invoke("psn_user_earned", { npCommunicationId, npServiceName: service }),
};

/** Used in a plain browser (no Tauri), e.g. UI development. Never fabricates data. */
export const unavailablePsnGateway: PsnGateway = {
  status: async () => ({ connected: false, needsReauth: false, connectedAt: null, refreshExpiresAt: null }),
  connect: async () => {
    throw { kind: "not_connected", message: "PSN integration is only available in the desktop app." };
  },
  disconnect: async () => undefined,
  ownProfile: async () => {
    throw { kind: "not_connected", message: "PSN integration is only available in the desktop app." };
  },
  userTitles: async () => {
    throw { kind: "not_connected", message: "PSN integration is only available in the desktop app." };
  },
  titleTrophies: async () => {
    throw { kind: "not_connected", message: "PSN integration is only available in the desktop app." };
  },
  titleTrophyGroups: async () => {
    throw { kind: "not_connected", message: "PSN integration is only available in the desktop app." };
  },
  userEarned: async () => {
    throw { kind: "not_connected", message: "PSN integration is only available in the desktop app." };
  },
};
