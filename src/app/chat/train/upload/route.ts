import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { File } from "buffer";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { NextRequest, NextResponse } from "next/server";
import { getEmbeddingsTransformer, searchArgs } from "../../openai";

export async function POST(req: NextRequest) {
  try {
    const formData: FormData = await req.formData();
    const uploadedFiles = formData.getAll("filepond");
    // let fileName = "";
    // let parsedText = "";

    if (uploadedFiles && uploadedFiles.length > 0) {
      // Parse the data from uploaded file
      const uploadedFile = uploadedFiles[1];
      console.log("Uploaded file:", uploadedFile);

      if (uploadedFile instanceof File) {
        // fileName = uploadedFile.name.toLowerCase();

        // const tempFilePath = `/tmp/${fileName}.pdf`;
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const loader = new PDFLoader(new Blob([arrayBuffer]));
        const rawDocs = await loader.load();

        // Spread data into chunks
        const splitDocs = await new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        }).splitDocuments(rawDocs);

        console.log("Split into " + splitDocs.length + " docs.");

        // console.log(JSON.stringify(chunks[0], null, 2));
        // return NextResponse.json({ message: "dev" }, { status: 500 });

        await MongoDBAtlasVectorSearch.fromDocuments(
          splitDocs,
          getEmbeddingsTransformer(),
          searchArgs(),
        );

        return NextResponse.json(
          { message: "Uploaded to MongoDB" },
          { status: 200 },
        );
      } else {
        console.log("Uploaded file is not in the expected format.");
        return NextResponse.json(
          { message: "Uploaded file is not in the expected format" },
          { status: 500 },
        );
      }
    } else {
      console.log("No files found.");
      return NextResponse.json({ message: "No files found" }, { status: 500 });
    }
  } catch (error) {
    console.error("Error processing request:", error);
    // Handle the error accordingly, for example, return an error response.
    return new NextResponse("An error occurred during processing.", {
      status: 500,
    });
  }
}
