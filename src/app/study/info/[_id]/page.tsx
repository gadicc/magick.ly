import { privateMetadata } from "@/seo/metadata";
import StudyInfo from "./info";

export const metadata = privateMetadata("Flashcard Progress");

export default async function StudyInfoPage({
  params,
}: PageProps<"/study/info/[_id]">) {
  return <StudyInfo _id={(await params)._id} />;
}
