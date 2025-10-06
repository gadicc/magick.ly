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
import { z } from "zod";

export const templeMembershipServerSchema = z.object({
  _id: z.instanceof(ObjectId),
  userId: z.instanceof(ObjectId),
  motto: z.string().optional(),
  templeId: z.instanceof(ObjectId),
  grade: z.coerce.number().int().positive(),
  admin: z.boolean().optional(),
  addedAt: z.date(),
  memberSince: z
    .date()
    .or(z.instanceof(dayjs as unknown as typeof Dayjs))
    .or(z.null())
    .optional(),
});

export const templeMembershipClientSchema = templeMembershipServerSchema
  .omit({
    _id: true,
    userId: true,
    templeId: true,
  })
  .extend({
    _id: z.string(),
    userId: z.string(),
    templeId: z.string(),
  });

export type TempleMembershipClient = GongoClientDocument &
  z.infer<typeof templeMembershipClientSchema>;
export type TempleMembershipServer = GongoServerDocument &
  z.infer<typeof templeMembershipServerSchema>;
