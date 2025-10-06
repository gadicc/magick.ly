import MuiLink from "@mui/material/Link";
import NextLink from "next/link";

export const Link = (props: React.ComponentProps<typeof MuiLink>) => {
  const { children, href, ...rest } = props;
  if (!href) {
    throw new Error("The 'href' prop is required for the Link component.");
  }

  return (
    <MuiLink component={NextLink} href={href} {...rest}>
      {children}
    </MuiLink>
  );
};

export default Link;
