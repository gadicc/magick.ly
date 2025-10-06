import { Box } from "@mui/material";
import React from "react";

const github = "https://github.com/gadicc/magick.ly/";
function url(str: string) {
  if (str.startsWith("http")) return str;
  return (
    github +
    "blob/master/" +
    str
      .replace(/^@\//, "src/")
      .replace(/^@magick-data\//, "data/")
      .replace(/^@magick-components\//, "src/components/")
  );
}

export default function OpenSource({
  href,
  files,
}: {
  href?: string;
  files?: string[];
}) {
  if (!(href || files)) throw new Error("href or files must be provided");

  return (
    <Box sx={{ mt: 1, mb: 1, fontSize: "80%" }}>
      Magick.ly is open-source. You can see the code used to generate this page
      in{" "}
      {href ? (
        <a href={url(href)}>{href.split("/").pop()}</a>
      ) : (
        files!.map((file, i) => {
          // const type = file.endsWith("page.tsx") ? "page" : "component";
          const label = file.split("/").pop();
          return (
            <React.Fragment key={file}>
              <a href={url(file)}>{label}</a>
              {i === files!.length - 2
                ? " and "
                : i === files!.length - 1
                  ? ""
                  : ", "}
            </React.Fragment>
          );
        })
      )}
      .
    </Box>
  );
}
