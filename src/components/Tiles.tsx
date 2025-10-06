import Image from "next/image";
import { Grid, ImageListItemBar } from "@mui/material";
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
            md: 3
          }}>
          <Link href={tile.to} underline="none">
            {tile.Component ? (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  overflow: "hidden",
                }}
              >
                <tile.Component
                  height="100%"
                  // className="MuiGridListTile-imgFullHeight"
                />
              </div>
            ) : null}
            {tile.img ? (
              typeof tile.img === "string" ? (
                // eslint-disable-next-line
                (<img
                  src={typeof tile.img === "object" ? tile.img.src : tile.img}
                  alt={tile.title}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />)
              ) : (
                <Image
                  src={tile.img}
                  style={{ objectFit: "cover", width: "100%", height: "100%" }}
                  alt={tile.alt}
                  sizes="(max-width: 1200px) 300px"
                />
              )
            ) : null}
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
