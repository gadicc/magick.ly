import "server-only";
import { getCurrentSqlUserId } from "../auth/session";
import { db } from "../db/neonFull";
import getSet from "./sets";
import { createSqlStudyService } from "./sql";

export const sqlStudyService = createSqlStudyService(db, getCurrentSqlUserId, {
  getCardIds(setId) {
    try {
      return Object.keys(getSet(setId).data);
    } catch {
      return null;
    }
  },
});
