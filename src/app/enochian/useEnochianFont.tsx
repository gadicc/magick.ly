import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import React from "react";
import EnochianFont from "@/components/enochian/enochianFont";

function EnochianFontToggleBase({
  enochianFont,
  setEnochianFont,
}: {
  enochianFont: boolean;
  setEnochianFont: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      value={enochianFont}
      sx={{ m: 1 }}
      size="small"
      onChange={() => setEnochianFont(!enochianFont)}
    >
      <ToggleButton value={false} aria-label="latin">
        A
      </ToggleButton>
      <ToggleButton
        value={true}
        aria-label="enochian"
        style={EnochianFont.style}
      >
        A
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

export default function useEnochianFont() {
  const [enochianFont, setEnochianFont] = React.useState<boolean>(false);

  const EnochianFontToggle = () =>
    React.createElement(EnochianFontToggleBase, {
      enochianFont,
      setEnochianFont,
    });

  return { enochianFont, EnochianFontToggle };
}

export { EnochianFont };
