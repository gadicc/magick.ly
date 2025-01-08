import { ObjectId } from "bson";
import { EnhancedOmit } from "gongo-server-db-mongo/lib/collection";

interface UserServer {
  [key: string]: unknown;
  _id: ObjectId;
  displayName: string;
  emails: {
    value: string;
    verified?: boolean;
  }[];
  services: {
    service: string;
    id: string;
    profile: {
      id: string;
      displayName: string;
      name?: {
        familyName: string;
        givenName: string;
      };
      emails: { value: string; verified: boolean }[];
      photos: { value: string }[];
      provider: string;
      _json: Record<string, unknown>;
    };
  }[];
  photos: {
    value: string;
  }[];
  admin?: boolean;
  groupIds?: ObjectId[];
  groupAdminIds?: ObjectId[];
  discourseId?: number;
}

type UserClientFields = {
  _id: string;
  groupIds: string[];
  groupAdminIds: string[];
};

// https://github.com/microsoft/TypeScript/issues/54451
type MappedOmit<T, K extends keyof T> = {
  [P in keyof T as P extends K ? never : P]: T[P];
};

type Prettify<T> = {
  [K in keyof T]: T[K];
  // eslint-disable-next-line @typescript-eslint/ban-types
} & {};

type UserClient = Prettify<
  MappedOmit<UserServer, keyof UserClientFields> & UserClientFields
>;

export type { UserServer, UserClient };
