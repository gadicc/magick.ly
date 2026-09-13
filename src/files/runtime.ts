import "server-only";

import { authorizeRitualFileRecord } from "./access";
import { filesRepository } from "./repository";
import {
  createAuthorizedRitualFileReader,
  createRitualFileLoomService,
} from "./ritualFileService";
import { filesStorage } from "./storage";

export const readAuthorizedRitualFile = createAuthorizedRitualFileReader({
  repository: filesRepository,
  storage: filesStorage,
  authorize: authorizeRitualFileRecord,
});

export const ritualFileService = createRitualFileLoomService({
  repository: filesRepository,
  readAuthorized: readAuthorizedRitualFile,
});
