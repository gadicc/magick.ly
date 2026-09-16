import { privateMetadata } from "@/seo/metadata";
import StudySetLoad from "./studySet";

export const metadata = privateMetadata("Flashcards");

export default async function StudySetPage({
  params,
}: PageProps<"/study/[_id]">) {
  return <StudySetLoad _id={(await params)._id} />;
}
