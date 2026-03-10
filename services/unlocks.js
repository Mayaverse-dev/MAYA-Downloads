'use strict';

function toUnlockThreshold(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function isUnlocked(asset, totalDownloads) {
  const threshold = toUnlockThreshold(asset && asset.unlockThreshold);
  return threshold === 0 || totalDownloads >= threshold;
}

function sanitizePublicAsset(asset, totalDownloads) {
  const threshold = toUnlockThreshold(asset.unlockThreshold);
  const unlocked = isUnlocked(asset, totalDownloads);
  const downloadsRemaining = unlocked ? 0 : Math.max(0, threshold - totalDownloads);
  const base = {
    ...asset,
    unlockThreshold: threshold,
    isLocked: !unlocked,
    downloadsRemaining,
  };
  if (unlocked) return base;
  return {
    ...base,
    // Never expose variant download URLs while locked.
    variants: [],
  };
}

function sanitizePublicAssetNoGamification(asset) {
  return {
    ...asset,
    unlockThreshold: toUnlockThreshold(asset.unlockThreshold),
    isLocked: false,
    downloadsRemaining: 0,
  };
}

function buildUnlockProgress(assets, totalDownloads) {
  const withGoals = assets
    .map((a) => ({ asset: a, threshold: toUnlockThreshold(a.unlockThreshold) }))
    .filter((x) => x.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);
  const next = withGoals.find((x) => totalDownloads < x.threshold) || null;
  if (!next) {
    return {
      totalDownloads,
      hasActiveGoal: false,
      nextThreshold: null,
      downloadsToNext: 0,
      progressPct: 100,
      nextAsset: null,
    };
  }
  return {
    totalDownloads,
    hasActiveGoal: true,
    nextThreshold: next.threshold,
    downloadsToNext: Math.max(0, next.threshold - totalDownloads),
    progressPct: Math.max(0, Math.min(100, Math.round((totalDownloads / next.threshold) * 100))),
    nextAsset: {
      id: next.asset.id,
      title: next.asset.title || '',
      description: next.asset.description || '',
      category: next.asset.category || '',
      thumbnailUrl: next.asset.thumbnailUrl || '',
      unlockThreshold: next.threshold,
    },
  };
}

module.exports = {
  toUnlockThreshold,
  isUnlocked,
  sanitizePublicAsset,
  sanitizePublicAssetNoGamification,
  buildUnlockProgress,
};
