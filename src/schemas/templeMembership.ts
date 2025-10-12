import { ObjectId } from "bson";
import type { GongoClientDocument } from "gongo-client";
import type { GongoDocument as GongoServerDocument } from "gongo-server-db-mongo/lib/collection";

/*

export interface TempleMembership extends GongoClientDocument {
  _id: string;
  userId: string;
  templeId: string;
  grade: number;
  admin?: boolean;
  addedAt: Date;
}
*/

import dayjs, { type Dayjs } from "dayjs";
import {
  boolean,
  custom,
  date,
  type InferOutput,
  instance,
  integer,
  minValue,
  null_,
  number,
  object,
  optional,
  pipe,
  string,
  transform,
  union,
} from "valibot";

// Accept number or number-like string, then enforce int >= 1
const gradeSchema = pipe(
  union([
    number(),
    pipe(
      string(),
      transform((v) => Number(v)),
    ),
  ]),
  integer(),
  minValue(0),
);

export const templeMembershipServerSchema = object({
  _id: instance(ObjectId),
  userId: instance(ObjectId),
  motto: optional(string()),
  templeId: instance(ObjectId),
  grade: gradeSchema,
  admin: optional(boolean()),
  addedAt: date(),
  memberSince: optional(
    union([
      date(),
      // Dayjs objects aren't constructed via a public class; use a custom guard.
      custom<Dayjs>((v): v is Dayjs => dayjs.isDayjs(v)),
      null_(),
    ]),
  ),
});

export const templeMembershipClientSchema = object({
  // string ids on the client
  _id: string(),
  userId: string(),
  templeId: string(),

  // shared fields
  motto: optional(string()),
  grade: gradeSchema,
  admin: optional(boolean()),
  addedAt: date(),
  memberSince: optional(
    union([
      date(),
      custom<Dayjs>((v): v is Dayjs => dayjs.isDayjs(v)),
      null_(),
    ]),
  ),
});

export type TempleMembershipClient = GongoClientDocument &
  InferOutput<typeof templeMembershipClientSchema>;
export type TempleMembershipServer = GongoServerDocument &
  InferOutput<typeof templeMembershipServerSchema>;
