import Link from "next/link";
import { privateMetadata } from "@/seo/metadata";
import { trainingAccess } from "./access";
import TrainingUpload from "./TrainingUpload";

export const metadata = privateMetadata("Chat Training");

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
          <Link href="/signin?callbackURL=%2Fchat%2Ftrain">Sign in</Link>
        </p>
      )}
    </main>
  );
}
