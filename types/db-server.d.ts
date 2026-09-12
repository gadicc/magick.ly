import type { ObjectId } from "bson";
import type { GongoDocument } from "gongo-server/lib/types";
import type { Collection } from "gongo-server-db-mongo";
import type { EnhancedOmit } from "gongo-server-db-mongo/lib/collection";
import type { Temple, TempleMembership, User } from "../src/schemas";

export type ServerCollection<T> = Collection<
  GongoDocument & EnhancedOmit<T, "_id"> & { _id: ObjectId }
>;

declare module "gongo-server-db-mongo" {
  class MongoDatabaseAdapter {
    collection(name: "users"): ServerCollection<User>;
    collection(name: "temples"): ServerCollection<Temple>;
    collection(name: "templeMemberships"): ServerCollection<TempleMembership>;
  }
}
