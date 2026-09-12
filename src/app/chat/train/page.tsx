import Link from "next/link";
import { trainingAccess } from "./access";
import TrainingUpload from "./TrainingUpload";

export default async function TrainingPage() {
  const access = await trainingAccess();
  return (
    <main>
      <h1>Chat training</h1>
      {access === 200 ? (
        <TrainingUpload />
      ) : (
        <p>
          Administrator sign-in is required.{" "}
          <Link href="/api/auth/signin?callbackUrl=%2Fchat%2Ftrain">
            Sign in
          </Link>
        </p>
      )}
    </main>
  );
}
