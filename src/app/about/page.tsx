import { Box, Container } from "@mui/material";

export default function Sequence() {
  return (
    <Container maxWidth="sm">
      <Box my={4}>
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
      </Box>
    </Container>
  );
}
