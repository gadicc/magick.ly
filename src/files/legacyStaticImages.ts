/**
 * Exact public URL aliases for the R100 renames in 05d4c96. The target images
 * subsequently changed in 6c71d32; these restore canonical locations, not old bytes.
 * Offline resolvers must retain the original occurrence/query/fragment identity.
 */
export const legacyStaticImageAliases = Object.freeze({
  "/pics/SevenBranchedCandleStick-magickli-export.png":
    "/pics/SevenBranchedCandleStick-magickly-export.png",
  "/pics/TableOfShewbread-magickli-export.png":
    "/pics/TableOfShewbread-magickly-export.png",
} as const);
