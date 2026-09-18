import { Box, Container } from "@mui/material";
import Link from "@/lib/link";
import { pageMetadata } from "@/seo/metadata";

export const metadata = pageMetadata("/about");

export default function Sequence() {
  return (
    <Container maxWidth="sm">
      <Box sx={{ my: 4 }}>
        <p>
          <i>Magick.ly - the open source Magick app</i>
        </p>

        <p>
          This is primarily a reference app for all things magickal, to help me
          in my studies. Maybe it will help you too.
        </p>

        <p>
          This is NOT an instruction app. By using this app you acknowledge that
          you will not attempt any ritual here without prior instruction either
          by a qualified teacher or self-study with an appropriate book.
          Attempting advanced magick without prior instruciton and training is
          dangerous and irreponsible.
        </p>

        <p>TODO - bibliography / starting points</p>

        <p>
          For questions, comments, feature requests, source code or to get
          involved, see{" "}
          <a href="https://github.com/gadicc/magick.ly">
            github.com/gadicc/magick.ly
          </a>
          .
        </p>

        <div>
          Design goals:
          <ul>
            <li>Open source, permissive licenses wherever possible.</li>
            <li>
              Publish useful magick{" "}
              <a href="https://github.com/gadicc/magick.ly/tree/master/data">
                data
              </a>{" "}
              in JSON format with types.
            </li>
            <li>
              Publish useful magick{" "}
              <a href="https://github.com/gadicc/magick.ly/tree/master/src/components">
                react components
              </a>
              .
            </li>
            <li>
              Images should be original, high quality vector images, and
              constructed procedurally (i.e. with iterative math vs human
              drawing), whenever possible.
            </li>
          </ul>
        </div>

        <p>Copyright (c) 2020 by Gadi Cohen, MIT licensed.</p>

        <h2 id="credits">Credits</h2>

        <p>Work by others that this app shows, with thanks:</p>

        <ul>
          <li>
            The planets photo on the <Link href="/astrology">Astrology</Link>{" "}
            page, also the link preview of the{" "}
            <Link href="/astrology/planets">planets</Link> pages:{" "}
            <a href="https://commons.wikimedia.org/wiki/File:Planets2013.svg">
              Planets2013.svg
            </a>{" "}
            by WP, from Wikimedia Commons, under{" "}
            <a href="https://creativecommons.org/licenses/by-sa/3.0">
              CC BY-SA 3.0
            </a>
            . We converted it to JPEG and crop it to fit; those changes are
            under the same licence.
          </li>
          <li>
            The robes photo on the{" "}
            <Link href="/gd/rituals">Golden Dawn rituals</Link> page, also the
            link preview of the ritual pages:{" "}
            <a href="https://commons.wikimedia.org/wiki/File:Anxfisa_Golden_Dawn_Robes.jpg">
              Anxfisa Golden Dawn Robes.jpg
            </a>{" "}
            by Anxfisa, from Wikimedia Commons, under{" "}
            <a href="https://creativecommons.org/licenses/by-sa/3.0">
              CC BY-SA 3.0
            </a>
            . We crop it to fit, under the same licence.
          </li>
          <li>
            The Sentinel&apos;s eye on the officer lamens:{" "}
            <a href="https://www.svgrepo.com/svg/322283/eye-of-horus">
              Eye of Horus
            </a>{" "}
            from SVG Repo, under CC BY, redrawn as a single path.
          </li>
          <li>
            The Kerux&apos;s caduceus on the officer lamens:{" "}
            <a href="https://www.svgrepo.com/svg/482800/caduceus-staff-icon">
              Caduceus staff
            </a>{" "}
            from SVG Repo, which is public domain.
          </li>
          <li>
            The <Link href="/kabbalah/tree">Tree of Life</Link> glyph is our
            own, drawn from measurements, and was inspired by{" "}
            <a href="https://commons.wikimedia.org/wiki/File:Tree_of_life_bahir_Hebrew.svg">
              Tree of life bahir Hebrew.svg
            </a>{" "}
            by User:AnonMoos, which is public domain.
          </li>
        </ul>
      </Box>
    </Container>
  );
}
