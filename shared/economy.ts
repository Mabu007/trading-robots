export const LICENSES = {
  personal: { name: 'Personal Use', publish: false, resale: false, terms: 'Use, modify, backtest and deploy privately for your own account. No public redistribution, managed access, republishing or resale. Copyright remains with the original author.' },
  commercial: { name: 'Commercial Remix', publish: true, resale: false, terms: 'Modify, backtest and deploy. Publish or sell derivative strategies only after changing executable source code; changing names, comments or whitespace is insufficient. Retain the original author and lineage attribution. Derivatives must retain these same restrictions; unchanged resale is prohibited. Copyright in the original code remains with its author.' },
  resale: { name: 'Full Resale Rights', publish: true, resale: true, terms: 'Use, modify, deploy, repackage, republish and resell, including unchanged code. Keep internal original-author and lineage records. This is a license, not a transfer of the original author’s copyright.' },
} as const;
export type LicenseKind = keyof typeof LICENSES;
export const LICENSE_REVISION = '2026-10-27.1';
export type CreatorProfile = { uid:string; username:string; displayName:string; bio:string; avatar:string; cover:string; createdAt:number; updatedAt:number };
