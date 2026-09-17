export type RankTier = 
  | "Mythic Prime"
  | "Mythic"
  | "Radiant"
  | "Immortal"
  | "Ascendant"
  | "Diamond"
  | "Platinum"
  | "Gold"
  | "Silver"
  | "Bronze"
  | "Unranked";

export interface RankInfo {
  label: RankTier;
  color: string;
  glow: "mythic" | "radiant" | "immortal" | "ascendant" | "diamond" | "none";
  intensity: number;
  minMmr: number;
}

export const RANK_TIERS: RankInfo[] = [
  { label: "Mythic Prime", color: "text-fuchsia-300", glow: "mythic", intensity: 1, minMmr: 3300 },
  { label: "Mythic", color: "text-fuchsia-400", glow: "mythic", intensity: 0.9, minMmr: 3000 },
  { label: "Radiant", color: "text-violet-300", glow: "radiant", intensity: 0.8, minMmr: 2700 },
  { label: "Immortal", color: "text-purple-300", glow: "immortal", intensity: 0.65, minMmr: 2400 },
  { label: "Ascendant", color: "text-purple-400", glow: "ascendant", intensity: 0.5, minMmr: 2100 },
  { label: "Diamond", color: "text-indigo-300", glow: "diamond", intensity: 0.35, minMmr: 1800 },
  { label: "Platinum", color: "text-sky-300", glow: "none", intensity: 0, minMmr: 1500 },
  { label: "Gold", color: "text-amber-300", glow: "none", intensity: 0, minMmr: 1000 },
  { label: "Silver", color: "text-slate-300", glow: "none", intensity: 0, minMmr: 500 },
  { label: "Bronze", color: "text-orange-400", glow: "none", intensity: 0, minMmr: 0 },
];

export function getRankForMmr(mmr: number | null | undefined, isInPlacement: boolean = false): RankInfo {
  // During placement (first 5 matches), always show Unranked
  if (isInPlacement || mmr === null || mmr === undefined || mmr < 0) {
    return { label: "Unranked", color: "text-zinc-400", glow: "none", intensity: 0, minMmr: -1 };
  }
  for (const tier of RANK_TIERS) {
    if (mmr >= tier.minMmr) {
      return tier;
    }
  }
  return RANK_TIERS[RANK_TIERS.length - 1];
}

export function getRankLabel(mmr: number | null | undefined): RankTier {
  return getRankForMmr(mmr).label;
}

export function hasGlowEffect(mmr: number | null | undefined): boolean {
  return getRankForMmr(mmr).glow !== "none";
}

export function isUnranked(mmr: number | null | undefined): boolean {
  return mmr === null || mmr === undefined || mmr < 0;
}
