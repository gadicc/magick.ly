// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const accountSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  providerId: v.string(),
  accountId: v.string(),
  userId: v.pipe(v.string(), v.uuid()),
  accessToken: v.nullable(v.string()),
  refreshToken: v.nullable(v.string()),
  idToken: v.nullable(v.string()),
  accessTokenExpiresAt: v.nullable(v.date()),
  refreshTokenExpiresAt: v.nullable(v.date()),
  scope: v.nullable(v.string()),
  password: v.nullable(v.string()),
  createdAt: v.date(),
  updatedAt: v.date(),
});

export const accountInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  providerId: v.string(),
  accountId: v.string(),
  userId: v.pipe(v.string(), v.uuid()),
  accessToken: v.optional(v.nullable(v.string())),
  refreshToken: v.optional(v.nullable(v.string())),
  idToken: v.optional(v.nullable(v.string())),
  accessTokenExpiresAt: v.optional(v.nullable(v.date())),
  refreshTokenExpiresAt: v.optional(v.nullable(v.date())),
  scope: v.optional(v.nullable(v.string())),
  password: v.optional(v.nullable(v.string())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export const accountUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  providerId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  accessToken: v.optional(v.nullable(v.string())),
  refreshToken: v.optional(v.nullable(v.string())),
  idToken: v.optional(v.nullable(v.string())),
  accessTokenExpiresAt: v.optional(v.nullable(v.date())),
  refreshTokenExpiresAt: v.optional(v.nullable(v.date())),
  scope: v.optional(v.nullable(v.string())),
  password: v.optional(v.nullable(v.string())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export type AccountSelect = v.InferOutput<typeof accountSelect>;
export type AccountInsert = v.InferInput<typeof accountInsert>;
export type AccountUpdate = v.InferInput<typeof accountUpdate>;
export const sessionSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  userId: v.pipe(v.string(), v.uuid()),
  token: v.string(),
  expiresAt: v.date(),
  ipAddress: v.nullable(v.string()),
  userAgent: v.nullable(v.string()),
  createdAt: v.date(),
  updatedAt: v.date(),
});

export const sessionInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.pipe(v.string(), v.uuid()),
  token: v.string(),
  expiresAt: v.date(),
  ipAddress: v.optional(v.nullable(v.string())),
  userAgent: v.optional(v.nullable(v.string())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export const sessionUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  token: v.optional(v.string()),
  expiresAt: v.optional(v.date()),
  ipAddress: v.optional(v.nullable(v.string())),
  userAgent: v.optional(v.nullable(v.string())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export type SessionSelect = v.InferOutput<typeof sessionSelect>;
export type SessionInsert = v.InferInput<typeof sessionInsert>;
export type SessionUpdate = v.InferInput<typeof sessionUpdate>;
export const userSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  name: v.string(),
  email: v.string(),
  emailVerified: v.boolean(),
  image: v.nullable(v.string()),
  createdAt: v.date(),
  updatedAt: v.date(),
});

export const userInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  name: v.string(),
  email: v.string(),
  emailVerified: v.optional(v.boolean()),
  image: v.optional(v.nullable(v.string())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export const userUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerified: v.optional(v.boolean()),
  image: v.optional(v.nullable(v.string())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export type UserSelect = v.InferOutput<typeof userSelect>;
export type UserInsert = v.InferInput<typeof userInsert>;
export type UserUpdate = v.InferInput<typeof userUpdate>;
export const verificationSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  identifier: v.string(),
  value: v.string(),
  expiresAt: v.date(),
  createdAt: v.date(),
  updatedAt: v.date(),
});

export const verificationInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  identifier: v.string(),
  value: v.string(),
  expiresAt: v.date(),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export const verificationUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  identifier: v.optional(v.string()),
  value: v.optional(v.string()),
  expiresAt: v.optional(v.date()),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export type VerificationSelect = v.InferOutput<typeof verificationSelect>;
export type VerificationInsert = v.InferInput<typeof verificationInsert>;
export type VerificationUpdate = v.InferInput<typeof verificationUpdate>;
