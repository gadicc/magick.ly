import { Container, Typography } from "@mui/material";
import { redirect } from "next/navigation";
import { db, ObjectId } from "@/api-lib/db";
import { auth } from "@/auth";

function Page({ message, error }: { message: string; error?: boolean }) {
  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">Join Temple</Typography>
      <p style={{ color: error ? "red" : "" }}>{message}</p>
      <a href="/temples">Back to temples page.</a>
    </Container>
  );
}

export default async function TemplesJoinPage(props: {
  params: Promise<{ slug: string; pass: string }>;
}) {
  const params = await props.params;

  const { slug, pass } = params;

  const session = await auth();
  console.log({ session });

  if (!session) {
    const callbackUrl = "/temples/join/" + slug + "/" + pass;
    const searchParams = new URLSearchParams({ callbackUrl });
    const url = "/api/auth/signin?" + searchParams.toString();
    redirect(url);
  }

  const temple = await db
    .collection("temples")
    .findOne({ slug, joinPass: pass });

  if (!temple) return <Page error message="No such temple and/or code." />;

  const userId = new ObjectId(session.user.id);

  const exinstingMembership = await db
    .collection("templeMemberships")
    .findOne({ templeId: temple._id, userId });

  console.log(exinstingMembership);

  if (exinstingMembership)
    return <Page error message="You are already a member of this temple." />;

  await db.collection("templeMemberships").insertOne({
    userId,
    templeId: temple._id,
    grade: 0,
    addedAt: new Date(),
  });

  return <Page message="You have successfully joined the temple." />;
}
