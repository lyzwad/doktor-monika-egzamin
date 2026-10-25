export const DATA_EPOCH: string;
export function takeoverFileName(release: { bankSha256: string }): string;
export function takeoverScript(release: { bankVersion: string; bankSha256: string; bankFile: string }): string;
