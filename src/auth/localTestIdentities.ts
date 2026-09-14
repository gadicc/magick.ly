/** Fixed synthetic identities shared by the local acceptance seeder and dev UI. */
export const LOCAL_ACCEPTANCE_USERS = [
  {
    role: "creator",
    id: "019a0000-0000-7000-8000-000000000001",
    name: "Synthetic Creator",
    email: "creator@local-acceptance.test",
  },
  {
    role: "reader",
    id: "019a0000-0000-7000-8000-000000000002",
    name: "Synthetic Reader",
    email: "reader@local-acceptance.test",
  },
  {
    role: "admin",
    id: "019a0000-0000-7000-8000-000000000003",
    name: "Synthetic Global Admin",
    email: "admin@local-acceptance.test",
  },
] as const;
