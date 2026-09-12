import { NextResponse } from "next/server";
import { trainingAccess } from "../access";
import { IngestionError, ingestPdf } from "../ingestPdf";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) {
      return NextResponse.json(
        { message: "Cross-origin training uploads are not allowed." },
        { status: 403 },
      );
    }

    const access = await trainingAccess();
    if (access !== 200) {
      return NextResponse.json(
        { message: "Administrator sign-in is required." },
        { status: access },
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { message: "Send a PDF using a multipart upload." },
        { status: 400 },
      );
    }

    // FilePond may send a metadata string before the actual File. Select by
    // type, rather than assuming the file is always the second entry.
    const files = formData
      .getAll("filepond")
      .filter((entry): entry is File => typeof entry !== "string");
    if (files.length !== 1) {
      return NextResponse.json(
        { message: "Choose exactly one PDF." },
        { status: 400 },
      );
    }

    const result = await ingestPdf(files[0]);
    return NextResponse.json({ message: "Uploaded to Pinecone.", ...result });
  } catch (error) {
    if (error instanceof IngestionError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { message: "Chat training is temporarily unavailable." },
      { status: 500 },
    );
  }
}
