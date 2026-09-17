import { Box, Grid, ImageListItemBar } from "@mui/material";
import Image from "next/image";
import Link from "@/lib/link";

function Tiles({ tiles }) {
  return (
    <Grid container spacing={0}>
      {tiles.map((tile) => (
        <Grid
          key={tile.to}
          sx={{
            height: 180,
            position: "relative",
            overflow: "hidden",
          }}
          size={{
            xs: 6,
            sm: 4,
            md: 3,
          }}
        >
          {/*
            A preview can draw its own links (GradeTree does), and links
            can't nest, so the preview sits beside the tile's link, which
            covers it. `inert` keeps the preview's links out of the tab
            order and the accessibility tree. Text previews keep the link
            colour they had inside the link.
          */}
          <Box
            inert
            sx={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
              color: "primary.main",
            }}
          >
            {tile.Component ? (
              <tile.Component
                height="100%"
                // className="MuiGridListTile-imgFullHeight"
              />
            ) : null}
            {tile.img ? (
              typeof tile.img === "string" ? (
                // biome-ignore lint/performance/noImgElement: conditional, check elsewhere
                <img
                  src={typeof tile.img === "object" ? tile.img.src : tile.img}
                  alt={tile.title}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <Image
                  src={tile.img}
                  style={{ objectFit: "cover", width: "100%", height: "100%" }}
                  alt={tile.alt}
                  sizes="(max-width: 1200px) 300px"
                />
              )
            ) : null}
          </Box>
          <Link
            href={tile.to}
            underline="none"
            sx={{
              position: "absolute",
              inset: 0,
              // The tile clips overflow, so draw the focus ring inside it.
              "&:focus-visible": { outlineOffset: "-3px" },
            }}
          >
            <ImageListItemBar
              sx={{ background: "rgba(0, 0, 0, 0.6)" }}
              title={tile.title}
            />
          </Link>
        </Grid>
      ))}
    </Grid>
  );
}

export default Tiles;
